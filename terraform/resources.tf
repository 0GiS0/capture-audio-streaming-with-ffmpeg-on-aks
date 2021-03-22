### Backend ####
terraform {
  backend "azurerm" {
  }
}


### Providers ###
provider "azurerm" {
  features {}
}


#Random name
resource "random_pet" "service" {
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


#Azure Container Registry
resource "azurerm_container_registry" "acr" {
  name                = replace(random_pet.service.id, "-", "")
  resource_group_name = azurerm_resource_group.k8s.name
  location            = azurerm_resource_group.k8s.location
  sku                 = "Standard"
  admin_enabled       = false
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

  identity {
    type = "SystemAssigned"
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

#Role assignment
resource "azurerm_role_assignment" "role_acrpull" {
  scope                            = azurerm_container_registry.acr.id
  role_definition_name             = "AcrPull"
  principal_id                     = azurerm_kubernetes_cluster.k8s.kubelet_identity.0.object_id
  skip_service_principal_aad_check = true
}


#Storage Account for final assets
resource "azurerm_storage_account" "storage" {
  name                     = replace(random_pet.service.id, "-", "")
  resource_group_name      = azurerm_resource_group.k8s.name
  location                 = azurerm_resource_group.k8s.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
}
