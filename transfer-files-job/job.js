const fs = require("fs"),
    path = require("path"),
    { getAudioDurationInSeconds } = require("get-audio-duration"),
    azure = require('azure-storage'),
    { BlobServiceClient, StorageSharedKeyCredential } = require("@azure/storage-blob"),
    moment = require("moment");

require("dotenv").config();

//constants
const TABLE_STORAGE = 'audios';

// Globals

var containerClient = null;
var tableClient = null;

var candidatesToTransfer = new Array();
var referenceDate = null;

var registries = null;


//Recupero todos los archivos de la carpeta donde se están grabando
fs.readdir(process.env.FOLDER, async function (err, files) {

    //Compruebo si ha habido algún error al escanear
    if (err) {
        return console.log(`Unable to scan the directory ${process.env.FOLDER}`);
    }

    //Configuro los clientes de Azure Storage (para crear blobs e insertar registros en la tabla)
    await configureStorageAccount();

    //Como fecha de referencia cojo la última guardada en Azure Table Storage
    var query = new azure.TableQuery()
        .where('PartitionKey eq ?', process.env.STREAM_NAME.toLocaleLowerCase());

    tableClient.queryEntities(TABLE_STORAGE, query, null, async function (error, result, response) {
        if (error) {
            // query was successful
            console.error(`[ERROR]: ${error}`);
        }

        console.log(`results from Azure Storage Table`);
        console.log(result);

        registries = result.entries;

        //TODO: recuperar el último registro guardado para este stream



        //Y si no hay ninguna fecha elijo el momento actual
        referenceDate = moment(new Date());


        //Get only audio files
        var audioFiles = files.filter((file) => {
            return path.extname(file) == '.mp3'
        });

        console.log(`Audio files in ${process.env.FOLDER}`);
        console.log(audioFiles);


        for (const file of audioFiles) {
            console.log(`Analyzing file ${file}`);

            //Recupero la duración del archivo
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

        console.log(`The nearest file is: ${nearestFile}`);

        if (nearestFile) {

            //Configure storage account
            console.log(`Configure storage account`);


            //Transfer file
            console.log(`Transfer file ${nearestFile}`);
            referenceDate = getDateFromFileName(nearestFile);
            await transferToBlob(nearestFile);

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
        }
        else {
            console.log(`Nothing to transfer`);
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
        // throw error;
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

    var row = {
        PartitionKey: { '_': process.env.STREAM_NAME.toLocaleLowerCase() },
        RowKey: azure.TableUtilities.entityGenerator.String(registries.length.toString()),
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