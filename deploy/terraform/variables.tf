variable "aws_region" {
  description = "AWS region to deploy the cluster into."
  type        = string
  default     = "us-east-1"
}

variable "cluster_name" {
  description = "EKS cluster name. Also used to namespace the VPC and IAM resources."
  type        = string
  default     = "aicser-ee-prod"
}

variable "kubernetes_version" {
  description = "EKS control plane version."
  type        = string
  default     = "1.30"
}

variable "vpc_cidr" {
  description = "CIDR block for the cluster VPC."
  type        = string
  default     = "10.42.0.0/16"
}

variable "node_instance_types" {
  description = "Instance types for the managed node group (server/client pods)."
  type        = list(string)
  default     = ["m6i.large"]
}

variable "node_min_size" {
  description = "Floor for the cluster autoscaler — never scale below this many nodes."
  type        = number
  default     = 2
}

variable "node_max_size" {
  description = "Ceiling for the cluster autoscaler. Raise this before raising the HPA's maxReplicas in values.yaml, or pods will just stay Pending once nodes are maxed out."
  type        = number
  default     = 6
}

variable "node_desired_size" {
  description = "Initial node count. The autoscaler adjusts this at runtime; it's just the starting point."
  type        = number
  default     = 2
}
