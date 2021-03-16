variable "agent_count" {
  default = 1
}

variable "location" {
  default = "North Europe"
}

# refer https://azure.microsoft.com/pricing/details/monitor/ for log analytics pricing 
variable "log_analytics_workspace_sku" {
  default = "PerGB2018"
}