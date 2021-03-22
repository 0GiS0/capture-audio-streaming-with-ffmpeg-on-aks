### 0. Execute ffmpeg locally ###

#Mac & Linux
AUDIO_STREAM="http://[STREAM_URL]"
mkdir -p chunks
ffmpeg -y -i ${AUDIO_STREAM} -f segment -segment_time 300 -strftime 1 chunks/%Y%m%dT%H%M%S.mp3

#Windows (PowerShell)
$AUDIO_STREAM="http://[STREAM_URL]"
mkdir -p chunks
ffmpeg -y -i ${AUDIO_STREAM}  -f segment -segment_time 300 -strftime 1 chunks/%Y%m%dT%H%M%S.mp3


### 1. Execute ffmpeg on Docker ###
#Mac & Linux
docker run \
    -v "$(pwd)/chunks":/ffmpeg/chunks \
    jrottenberg/ffmpeg:4.1-alpine \
    -y -i ${AUDIO_STREAM} -f segment -segment_time 300 -strftime 1 /ffmpeg/chunks/%Y%m%dT%H%M%S.mp3

#Windows (PowerShell)
docker run `
    -v ${PWD}\chunks:/ffmpeg/chunks `
    jrottenberg/ffmpeg:4.1-alpine `
    -y -i ${AUDIO_STREAM} -f segment -segment_time 300 -strftime 1 /ffmpeg/chunks/%Y%m%dT%H%M%S.mp3

### 2. Deploy Azure resources using Terraform ###

cd terraform

# Initialize Terraform
# Yo need an extra storage account to store the TF state (this one cannot be included in the terraform configuration)
terraform init \
    -backend-config="storage_account_name=STORAGE_NAME" \
    -backend-config="container_name=STORAGE_CONTAINER" \
    -backend-config="key=capture-audio-stream-with-ffmpeg.tfstate" \
    -backend-config="access_key=STORAGE_ACCESS_KEY"

terraform plan -out ffmpeg-env.tfplan

terraform apply ffmpeg-env.tfplan

#Mac & Linux
SERVICE_NAME=$(terraform output -raw service_name)
ACR_NAME=$(terraform output -raw acr_name)
CONNECTION_STRING=$(terraform output -raw storage_account_connectionstring)

#Windows (PowerShell)
$SERVICE_NAME=$(terraform output -raw service_name)
$ACR_NAME=$(terraform output -raw acr_name)
$CONNECTION_STRING=$(terraform output -raw storage_account_connectionstring)


### 3. Build transfer-files-job image ###
cd ..
cd transfer-files-job


#Login Azure Container Registry
az acr login -g $SERVICE_NAME -n $ACR_NAME

#Build and push the image
docker build -t ${ACR_NAME}.azurecr.io/transfer-files-job .
docker push ${ACR_NAME}.azurecr.io/transfer-files-job

### 4. Execute on AKS ###
az aks get-credentials -g $SERVICE_NAME -n $SERVICE_NAME


######## REQUIRED CHANGES ############

# 1. The configuration of the stream is in config-map.yaml
#    You should change at least:
#       stream:  #The stream URL you want to record
#       stream.name:  #The stream name (in order to create a folder and a container)

#2. The connection string in base64 for the azure storage account > secret.yaml

#  Mac & Linux
echo -n $CONNECTION_STRING | base64
#  Windows (PowerShell)
[System.Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($CONNECTION_STRING))

#########################################

# Deploy all resources in AKS
cd ..
kubectl apply -f manifests/ 

#Watch pods (from the deployment and the cronjob)
kubectl get pods -w

#You can check on Azure Storage the file that are transferred

#Helm to template the resources and deploy them multiple times
helm install myaudiostream ./helm/ffmpeg --set streamName=STREAM_NAME --set streamURL=https://STREAM_URL --set storageConnectionString=$CONNECTION_STRING --set cronImage=${ACR_NAME}.azurecr.io/transfer-files-job

helm uninstall myaudiostream

#Check resources
#Top
kubectl top pod
kubectl top node

#Run kube-advisor
kubectl run --rm -i -t kubeadvisor --image=mcr.microsoft.com/aks/kubeadvisor --restart=Never
