# Standard 3-AZ VPC for EKS: public subnets for the load balancer, private
# subnets for nodes/pods, one NAT gateway (single, not per-AZ, to keep cost
# down — bump to `single_nat_gateway = false` for per-AZ NAT redundancy).
#
# If you already have a VPC you want EKS to live in, delete this file and set
# `vpc_id`/`subnet_ids` directly in eks.tf from your existing network instead.

data "aws_availability_zones" "available" {
  state = "available"
}

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.8"

  name = "${var.cluster_name}-vpc"
  cidr = var.vpc_cidr

  azs             = slice(data.aws_availability_zones.available.names, 0, 3)
  private_subnets = [for i in range(3) : cidrsubnet(var.vpc_cidr, 4, i)]
  public_subnets  = [for i in range(3) : cidrsubnet(var.vpc_cidr, 4, i + 8)]

  enable_nat_gateway   = true
  single_nat_gateway   = true
  enable_dns_hostnames = true

  # Required tags for the AWS Load Balancer Controller / EKS to auto-discover
  # subnets for public ingress vs. internal node placement.
  public_subnet_tags = {
    "kubernetes.io/role/elb"                    = "1"
    "kubernetes.io/cluster/${var.cluster_name}" = "shared"
  }
  private_subnet_tags = {
    "kubernetes.io/role/internal-elb"           = "1"
    "kubernetes.io/cluster/${var.cluster_name}" = "shared"
  }
}
