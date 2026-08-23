# Aicser — Terraform (EKS) for real autoscaling

This is a **starting point**, not a turnkey production deployment. It provisions
the pieces needed for genuine autoscaling of the `server`/`client` tiers — an EKS
cluster, a managed node group with the cluster autoscaler wired up, and the IAM
role the autoscaler needs — and hands off to the Helm chart in
`deploy/helm/aicser/` for the application-level Deployments/HPAs.

**What this does not do**, deliberately:

- **Does not manage Postgres/Redis/Keycloak.** Self-hosting stateful services in
  Kubernetes (StatefulSets, PVCs, backup/restore, failover) is a different and
  harder problem than autoscaling a stateless app tier. For a real deployment,
  point `DATABASE_URL`/`REDIS_URL` at managed services instead — RDS Postgres
  and ElastiCache Redis on AWS are the natural fit alongside this EKS cluster.
  Keycloak can run in-cluster (it's already close to stateless behind its own
  DB) or as a managed identity provider — either way it's out of scope here.
- **Has not been `terraform apply`'d or `helm install`'d against a real cluster.**
  It was written to be structurally correct and to follow the standard
  `terraform-aws-modules/eks` pattern, but a Terraform module is only really
  verified by applying it. Review the plan carefully (`terraform plan`) before
  the first apply, especially `variables.tf`'s defaults (region, instance types,
  node counts) and the IAM boundary.
- **Assumes AWS.** "Kubernetes" is cloud-agnostic; the autoscaler wiring here
  (IRSA — IAM Roles for Service Accounts) is AWS-specific. Porting to
  GKE/AKS means swapping this directory's cloud-specific pieces (this file,
  `eks.tf`, `iam.tf`) for their equivalents — the Helm chart itself is portable
  as-is.

## Layout

- `versions.tf` — Terraform/provider version pins.
- `variables.tf` — cluster name, region, node instance types/counts, min/max
  for the autoscaler to work within.
- `vpc.tf` — a VPC sized for EKS (public + private subnets across 3 AZs,
  NAT gateway) via the community `terraform-aws-modules/vpc` module. If you
  already have a VPC you want to use instead, delete this file and pass its
  `vpc_id`/`subnet_ids` into `eks.tf` directly.
- `eks.tf` — the EKS cluster and a managed node group, via
  `terraform-aws-modules/eks/aws`, with the autoscaler-required tags
  (`k8s.io/cluster-autoscaler/enabled`, `k8s.io/cluster-autoscaler/<cluster-name>`)
  already on the node group's ASG.
- `iam.tf` — the IRSA role + policy the cluster-autoscaler add-on needs to call
  the AWS Auto Scaling API (describe/set-desired-capacity) for that ASG.
- `outputs.tf` — cluster name, endpoint, and the `aws eks update-kubeconfig`
  command to run after apply.

## Applying this

```bash
cd deploy/terraform
terraform init
terraform plan   # review carefully — this creates real, billed AWS resources
terraform apply
aws eks update-kubeconfig --name $(terraform output -raw cluster_name) --region $(terraform output -raw region)

# The cluster autoscaler itself is installed as a Helm release, not by Terraform,
# so it can be upgraded independently of infra changes:
helm repo add autoscaler https://kubernetes.github.io/autoscaler
helm install cluster-autoscaler autoscaler/cluster-autoscaler \
  --namespace kube-system \
  --set autoDiscovery.clusterName=$(terraform output -raw cluster_name) \
  --set awsRegion=$(terraform output -raw region) \
  --set rbac.serviceAccount.annotations."eks\.amazonaws\.com/role-arn"=$(terraform output -raw cluster_autoscaler_role_arn)

# Then install the application itself:
helm install aicser ../helm/aicser -f ../helm/aicser/values.yaml \
  --set server.image=<your-ecr-repo>/aicser-server:<tag> \
  --set client.image=<your-ecr-repo>/aicser-client:<tag>
```
