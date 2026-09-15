output "region" {
  value = var.aws_region
}

output "cluster_name" {
  value = module.eks.cluster_name
}

output "cluster_endpoint" {
  value = module.eks.cluster_endpoint
}

output "cluster_autoscaler_role_arn" {
  description = "Pass this to the cluster-autoscaler Helm release's rbac.serviceAccount.annotations."
  value       = aws_iam_role.cluster_autoscaler.arn
}

output "vpc_id" {
  value = module.vpc.vpc_id
}
