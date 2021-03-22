const fs = require("fs"),
    path = require("path"),
    { getAudioDurationInSeconds } = require("get-audio-duration"),
    azure = require('azure-storage'),
    { BlobServiceClient } = require("@azure/storage-blob"),
    moment = require("moment");

require("dotenv").config();


const TABLE_STORAGE = 'audios';
var containerClient = null;
var tableClient = null;
var candidatesToTransfer = new Array();
var referenceDate = null;


//I recover all the files from the folder where they are being recorded
fs.readdir(process.env.FOLDER, async function (err, files) {

    //I check for an error while scanning
    if (err) {
        return console.log(`Unable to scan the directory ${process.env.FOLDER}`);
    }

    //I configure Azure Storage clients (to create blobs and insert records in the table)
    await configureStorageAccount();

    //As a reference date I take the last one saved in Azure Table Storage
    var query = new azure.TableQuery()
        .top(1)
        .where('PartitionKey eq ?', process.env.STREAM_NAME.toLocaleLowerCase());

    tableClient.queryEntities(TABLE_STORAGE, query, null, async function (error, result, response) {
        if (error) {
            // query was successful
            console.error(`[ERROR]: ${error}`);
        }

        console.log(`results from Azure Storage Table`);
        console.log(result);
        console.log(`result.entries.length: ${result.entries.length}`);

        if (result.entries.length > 0) {
            // Reference date based on the last file recorded
            var lastFileRecorded = result.entries[0];
            console.log(`lastFileRecorded:`)
            console.log(lastFileRecorded);
            referenceDate = getDateFromFileName(lastFileRecorded.fileName._);

        }
        else {
            // And if there is no file I choose the current moment
            referenceDate = moment(new Date());
        }

        console.log(`The reference date is: ${referenceDate}`);


        //Get only audio files
        var audioFiles = files.filter((file) => {
            return path.extname(file) == '.mp3'
        });

        console.log(`Audio files in ${process.env.FOLDER}`);
        console.log(audioFiles);


        for (const file of audioFiles) {
            console.log(`Analyzing file ${file}`);

            //I retrieve the duration of the file
            var duration = await getAudioDurationInSeconds(`${process.env.FOLDER}/${file}`);

            console.log(`${file} duration: ${Math.round(duration / 60)} minutes.`);
            console.log(`It should be ${process.env.FILE_DURATION} seconds (${process.env.FILE_DURATION / 60} minutes)`);

            if (Math.round(duration) == process.env.FILE_DURATION) {
                console.log(`We have a candidate: ${file}`);
                candidatesToTransfer.push(file);
            }
        }

        let nearestFile;

        for (const candidate of candidatesToTransfer) {

            var dateToCompare = getDateFromFileName(candidate);

            console.log(`dateToCompare: ${dateToCompare}`);

            let diff = referenceDate.diff(dateToCompare, 'seconds');
            console.log(`diff: ${diff}`);


            //If there are files older than 10 minutes (600 seconds)
            if (diff < -600) {
                console.log(`There are files older than 10 minutes`);

                //Order by date
                candidatesToTransfer.sort((a, b) => {
                    return getDateFromFileName(a) - getDateFromFileName(b);
                });

                console.log(`candidates ordered by date:`);
                console.log(candidatesToTransfer);

                //Pick up with the candidates closest to the reference date (Get the odd elements of the array in order to get the closest)
                for (var i = 0; i < candidatesToTransfer.length; i++) {
                    if (i % 2 !== 0) { // index is odd
                        var fileToTransfer = candidatesToTransfer[i];
                        //Transfer file
                        console.log(`Transfer file ${fileToTransfer}`);
                        referenceDate = getDateFromFileName(fileToTransfer);
                        await transferToBlob(fileToTransfer);
                    }
                }
            }
            else {

                if (diff > 0) {
                    if (nearestFile) {
                        var nearestDate = getDateFromFileName(nearestFile);
                        if (nearestDate.diff(dateToCompare, 'seconds') < 0) {
                            nearestFile = candidate;
                        }
                    }
                    else {
                        nearestFile = candidate;
                    }
                }
            }
        }

        console.log(`There is a file next to the one saved : ${nearestFile}`);

        if (nearestFile) {

            //Transfer file
            console.log(`Transfer file ${nearestFile}`);
            referenceDate = getDateFromFileName(nearestFile);
            await transferToBlob(nearestFile);
        }

        //Remove closed files
        console.log(`************** DELETE LOCAL FILES **************`);
        for (const file of audioFiles) {
            console.log(`Check file ${file}`);
            var filePath = `${process.env.FOLDER}/${file}`;

            //Get the date to the file
            var fileToDeleteDate = getDateFromFileName(file);
            console.log(`The date of the file to delete: ${fileToDeleteDate}`);

            //Compare the ref date if is lower
            if (fileToDeleteDate.isSameOrBefore(referenceDate)) {
                console.log(`The date ${fileToDeleteDate} is same/before the reference date ${referenceDate} so delete it`);
                removeFile(filePath);
            }
        }

    });

});

    //Utils
    function getDateFromFileName(file) {
        return moment(file.split("_")[1].replace(path.extname(file), ""));
    }


    //Transfer copies to blob storage
    async function configureStorageAccount() {

        tableClient = azure.createTableService();

        // Create table if not exists
        tableClient.createTableIfNotExists(TABLE_STORAGE, function (error, result, response) {
            if (!error) {
                // Table exists or created
            }
        });

        const blobServiceClient = new BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);


        //Create container    
        const containerName = process.env.STREAM_NAME.toLocaleLowerCase();
        containerClient = blobServiceClient.getContainerClient(containerName);

        //Create container if it doesn't exist
        try {
            console.log(`Trying to create the container ${containerName}`);
            const createContainerResponse = await containerClient.create();
            console.log(`Create container ${containerName} successfully`, createContainerResponse.requestId);

        } catch (error) {
            console.log(`[ERROR][configureStorageAccount] ${error.message}`);
        }
    }

    async function transferToBlob(fileName) {

        const blobName = `${moment(fileName.split("_")[1].replace(path.extname(fileName), '')).format("DD-MM-YYYY")}/${fileName}`;

        console.log(`Trying to upload ${blobName}`);

        const blockBlobClient = containerClient.getBlockBlobClient(blobName);

        try {
            const uploadBlobResponse = await blockBlobClient.uploadFile(`${process.env.FOLDER}/${fileName}`);
            console.log(`Upload block blob ${blobName} successfully`, uploadBlobResponse.requestId);

            console.log(`Save ${fileName} in Azure Storage Table`);
            await registryInsertion(fileName);

        } catch (error) {
            console.log(`[ERROR][transferToBlob] ${error.message}`);
            throw error;
        }
    }

    async function registryInsertion(lastFileInserted) {

        console.log(`*********** INSERT REGISTRY IN AZURE STORAGE TABLE ***********`);

        var maxValueTicks = moment(new Date(9999, 12, 31, 23, 59, 59, 9999999)).unix();
        console.log(`maxValueTicks :${maxValueTicks}`);
        var currentTicks = moment().unix();
        console.log(`currentTicks: ${currentTicks}`);

        console.log(`Final ticks value: ${maxValueTicks - currentTicks}`);

        var row = {
            PartitionKey: { '_': process.env.STREAM_NAME.toLocaleLowerCase() },
            RowKey: azure.TableUtilities.entityGenerator.String((maxValueTicks - currentTicks).toString()), //It will help me to fetch the last entry
            fileName: lastFileInserted
        }

        tableClient.insertEntity(TABLE_STORAGE, row, function (error, result, response) {
            if (!error) {
                // Entity inserted
                console.log(`audio ${lastFileInserted} recorded`);
            }
        });
    }

    function removeFile(file) {
        fs.unlink(file, (err) => {
            if (err) {
                console.error(err)
                return
            }

            console.log(`${file} removed`);

        });
    }
