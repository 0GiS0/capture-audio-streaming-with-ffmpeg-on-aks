output "service_name" {
  value = random_pet.service.id
}

output "storage_account_connectionstring" {
  value = azurerm_storage_account.storage.primary_connection_string
}
