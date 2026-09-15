# EKS cluster + one managed node group, sized for the server/client Deployments
# in ../helm/aicser. The node group's ASG carries the two tags the cluster
# autoscaler's --node-group-auto-discovery flag looks for, so the autoscaler
# (installed separately via Helm — see README.md) finds it without manual
# per-ASG config.

module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.0"

  cluster_name    = var.cluster_name
  cluster_version = var.kubernetes_version

  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnets

  cluster_endpoint_public_access = true

  eks_managed_node_groups = {
    app = {
      instance_types = var.node_instance_types
      min_size       = var.node_min_size
      max_size       = var.node_max_size
      desired_size   = var.node_desired_size

      labels = {
        workload = "aicser-app"
      }

      tags = {
        "k8s.io/cluster-autoscaler/enabled"             = "true"
        "k8s.io/cluster-autoscaler/${var.cluster_name}" = "owned"
      }
    }
  }

  # Lets `kubectl`/`helm` from the machine that ran `terraform apply` manage
  # the cluster immediately, in addition to whatever IAM roles you add later.
  enable_cluster_creator_admin_permissions = true
}
