### Backend ####
terraform {
  backend "azurerm" {
  }
}


### Providers ###
provider "azurerm" {
  features {}
}

provider "azuread" {
}

#Random name
resource "random_pet" "service" {
}

#Random password
resource "random_string" "password" {
  length  = 32
  special = true
}

#Create an Azure AD App
resource "azuread_application" "app" {
  display_name = random_pet.service.id
  homepage     = "http://${random_pet.service.id}"
}

#Create a service principal
resource "azuread_service_principal" "sp" {
  application_id               = azuread_application.app.application_id
  app_role_assignment_required = false
}

#Create a password for the azure ad service principal
resource "azuread_service_principal_password" "secret" {
  service_principal_id = azuread_service_principal.sp.id
  description          = "secret"
  value                = random_string.password.result
  end_date             = "2099-01-01T01:02:03Z"
}


#Resource group
resource "azurerm_resource_group" "k8s" {
  name     = random_pet.service.id
  location = var.location
}

#Log Analytics
resource "azurerm_log_analytics_workspace" "akslogs" {
  # The WorkSpace name has to be unique across the whole of azure, not just the current subscription/tenant.
  name                = random_pet.service.id
  location            = var.location
  resource_group_name = azurerm_resource_group.k8s.name
  sku                 = var.log_analytics_workspace_sku
}

#Container Insights solution
resource "azurerm_log_analytics_solution" "insights" {
  solution_name         = "ContainerInsights"
  location              = azurerm_log_analytics_workspace.akslogs.location
  resource_group_name   = azurerm_resource_group.k8s.name
  workspace_resource_id = azurerm_log_analytics_workspace.akslogs.id
  workspace_name        = azurerm_log_analytics_workspace.akslogs.name

  plan {
    publisher = "Microsoft"
    product   = "OMSGallery/ContainerInsights"
  }
}

#AKS clúster
resource "azurerm_kubernetes_cluster" "k8s" {
  name                = random_pet.service.id
  location            = azurerm_resource_group.k8s.location
  resource_group_name = azurerm_resource_group.k8s.name
  dns_prefix          = random_pet.service.id


  default_node_pool {
    name       = "agentpool"
    node_count = var.agent_count
    vm_size    = "Standard_D2_v2"
  }

  service_principal {
    client_id     = azuread_service_principal.sp.application_id
    client_secret = azuread_service_principal_password.secret.value
  }

  addon_profile {
    kube_dashboard {
      enabled = false
    }
    oms_agent {
      enabled                    = true
      log_analytics_workspace_id = azurerm_log_analytics_workspace.akslogs.id
    }
  }

  network_profile {
    load_balancer_sku = "Standard"
    network_plugin    = "kubenet"
  }
}


#Storage Account for final assets
resource "azurerm_storage_account" "storage" {
  name                     = replace(random_pet.service.id, "-", "")
  resource_group_name      = azurerm_resource_group.k8s.name
  location                 = azurerm_resource_group.k8s.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
}
