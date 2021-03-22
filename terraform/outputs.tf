output "service_name" {
  value = random_pet.service.id
}

output "acr_name" {
  value = azurerm_container_registry.acr.name
}

output "storage_account_connectionstring" {
  value = azurerm_storage_account.storage.primary_connection_string
}
