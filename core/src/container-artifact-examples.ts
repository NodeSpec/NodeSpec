/**
 * Example artifact content for container configurations
 * These provide production-ready templates that users can copy to their cloud environments
 */

export interface ArtifactExample {
  name: string;
  description: string;
  content: string;
  language: string;
}

export const KUBERNETES_NAMESPACE_EXAMPLES: Record<string, ArtifactExample> = {
  namespace: {
    name: 'Kubernetes Namespace',
    description: 'Complete namespace definition with labels and annotations',
    language: 'yaml',
    content: `apiVersion: v1
kind: Namespace
metadata:
  name: production
  labels:
    name: production
    environment: production
    app.kubernetes.io/managed-by: nodal
    app.kubernetes.io/part-of: microservices-platform
  annotations:
    description: "Production environment for microservices"
    contact: "platform-team@company.com"
`,
  },

  resourceQuota: {
    name: 'Resource Quota',
    description: 'Enforce resource limits at namespace level',
    language: 'yaml',
    content: `apiVersion: v1
kind: ResourceQuota
metadata:
  name: production-quota
  namespace: production
spec:
  hard:
    requests.cpu: "10"
    requests.memory: 20Gi
    requests.storage: 50Gi
    limits.cpu: "20"
    limits.memory: 40Gi
    persistentvolumeclaims: "10"
    pods: "100"
    services: "50"
    services.loadbalancers: "5"
    services.nodeports: "10"
`,
  },

  limitRange: {
    name: 'Limit Range',
    description: 'Default and max resource limits per pod/container',
    language: 'yaml',
    content: `apiVersion: v1
kind: LimitRange
metadata:
  name: production-limitrange
  namespace: production
spec:
  limits:
  - type: Pod
    max:
      cpu: "4"
      memory: 8Gi
    min:
      cpu: 100m
      memory: 128Mi
  - type: Container
    default:
      cpu: 500m
      memory: 512Mi
    defaultRequest:
      cpu: 100m
      memory: 128Mi
    max:
      cpu: "2"
      memory: 4Gi
    min:
      cpu: 50m
      memory: 64Mi
  - type: PersistentVolumeClaim
    max:
      storage: 10Gi
    min:
      storage: 1Gi
`,
  },

  networkPolicy: {
    name: 'Network Policy',
    description: 'Deny all ingress by default, allow DNS and same namespace',
    language: 'yaml',
    content: `---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: deny-all-ingress
  namespace: production
spec:
  podSelector: {}
  policyTypes:
  - Ingress

---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-dns
  namespace: production
spec:
  podSelector: {}
  policyTypes:
  - Egress
  egress:
  - to:
    - namespaceSelector:
        matchLabels:
          name: kube-system
    ports:
    - protocol: UDP
      port: 53

---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-same-namespace
  namespace: production
spec:
  podSelector: {}
  policyTypes:
  - Ingress
  ingress:
  - from:
    - podSelector: {}
`,
  },

  rbac: {
    name: 'RBAC Configuration',
    description: 'Role and RoleBinding for namespace access',
    language: 'yaml',
    content: `---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: production-deployer
  namespace: production

---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: production-deployer
  namespace: production
rules:
- apiGroups: ["", "apps", "batch"]
  resources: ["pods", "deployments", "services", "configmaps", "secrets", "jobs", "cronjobs"]
  verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
- apiGroups: ["networking.k8s.io"]
  resources: ["ingresses"]
  verbs: ["get", "list", "watch", "create", "update", "patch"]

---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: production-deployer
  namespace: production
subjects:
- kind: ServiceAccount
  name: production-deployer
  namespace: production
roleRef:
  kind: Role
  name: production-deployer
  apiGroup: rbac.authorization.k8s.io
`,
  },
};

export const DOCKER_COMPOSE_EXAMPLES: Record<string, ArtifactExample> = {
  compose: {
    name: 'Docker Compose Stack',
    description: 'Multi-container application with networking and volumes',
    language: 'yaml',
    content: `version: '3.8'

services:
  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
      target: production
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - API_URL=http://backend:8080
    depends_on:
      - backend
    networks:
      - app-network
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
      target: production
    ports:
      - "8080:8080"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://postgres:password@db:5432/appdb
      - REDIS_URL=redis://cache:6379
    depends_on:
      db:
        condition: service_healthy
      cache:
        condition: service_started
    networks:
      - app-network
    restart: unless-stopped
    deploy:
      resources:
        limits:
          cpus: '1.0'
          memory: 512M
        reservations:
          cpus: '0.5'
          memory: 256M

  db:
    image: postgres:15-alpine
    environment:
      - POSTGRES_DB=appdb
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=password
    volumes:
      - db-data:/var/lib/postgresql/data
      - ./db/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
    networks:
      - app-network
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

  cache:
    image: redis:7-alpine
    command: redis-server --appendonly yes
    volumes:
      - cache-data:/data
    networks:
      - app-network
    restart: unless-stopped

networks:
  app-network:
    driver: bridge

volumes:
  db-data:
  cache-data:
`,
  },
};

export const TERRAFORM_VPC_EXAMPLES: Record<string, ArtifactExample> = {
  main: {
    name: 'Terraform VPC Main',
    description: 'Complete VPC with public/private subnets across 3 AZs',
    language: 'hcl',
    content: `terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

locals {
  availability_zones = slice(data.aws_availability_zones.available.names, 0, var.az_count)

  common_tags = {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

data "aws_availability_zones" "available" {
  state = "available"
}

# VPC
resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = merge(local.common_tags, {
    Name = "\${var.project_name}-\${var.environment}-vpc"
  })
}

# Internet Gateway
resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = merge(local.common_tags, {
    Name = "\${var.project_name}-\${var.environment}-igw"
  })
}

# Public Subnets
resource "aws_subnet" "public" {
  count             = var.az_count
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index)
  availability_zone = local.availability_zones[count.index]

  map_public_ip_on_launch = true

  tags = merge(local.common_tags, {
    Name = "\${var.project_name}-\${var.environment}-public-\${local.availability_zones[count.index]}"
    Tier = "public"
  })
}

# Private Subnets
resource "aws_subnet" "private" {
  count             = var.az_count
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index + var.az_count)
  availability_zone = local.availability_zones[count.index]

  tags = merge(local.common_tags, {
    Name = "\${var.project_name}-\${var.environment}-private-\${local.availability_zones[count.index]}"
    Tier = "private"
  })
}

# NAT Gateways (one per AZ for HA)
resource "aws_eip" "nat" {
  count  = var.enable_nat_gateway ? var.az_count : 0
  domain = "vpc"

  tags = merge(local.common_tags, {
    Name = "\${var.project_name}-\${var.environment}-nat-eip-\${count.index + 1}"
  })

  depends_on = [aws_internet_gateway.main]
}

resource "aws_nat_gateway" "main" {
  count         = var.enable_nat_gateway ? var.az_count : 0
  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.public[count.index].id

  tags = merge(local.common_tags, {
    Name = "\${var.project_name}-\${var.environment}-nat-\${count.index + 1}"
  })

  depends_on = [aws_internet_gateway.main]
}

# Public Route Table
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = merge(local.common_tags, {
    Name = "\${var.project_name}-\${var.environment}-public-rt"
  })
}

resource "aws_route_table_association" "public" {
  count          = var.az_count
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# Private Route Tables (one per AZ)
resource "aws_route_table" "private" {
  count  = var.az_count
  vpc_id = aws_vpc.main.id

  tags = merge(local.common_tags, {
    Name = "\${var.project_name}-\${var.environment}-private-rt-\${count.index + 1}"
  })
}

resource "aws_route" "private_nat_gateway" {
  count                  = var.enable_nat_gateway ? var.az_count : 0
  route_table_id         = aws_route_table.private[count.index].id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.main[count.index].id
}

resource "aws_route_table_association" "private" {
  count          = var.az_count
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private[count.index].id
}

# VPC Flow Logs
resource "aws_flow_log" "main" {
  count                = var.enable_flow_logs ? 1 : 0
  iam_role_arn         = aws_iam_role.flow_logs[0].arn
  log_destination      = aws_cloudwatch_log_group.flow_logs[0].arn
  traffic_type         = "ALL"
  vpc_id               = aws_vpc.main.id
  max_aggregation_interval = 60

  tags = merge(local.common_tags, {
    Name = "\${var.project_name}-\${var.environment}-flow-logs"
  })
}

resource "aws_cloudwatch_log_group" "flow_logs" {
  count             = var.enable_flow_logs ? 1 : 0
  name              = "/aws/vpc/\${var.project_name}-\${var.environment}"
  retention_in_days = 7

  tags = local.common_tags
}

resource "aws_iam_role" "flow_logs" {
  count = var.enable_flow_logs ? 1 : 0
  name  = "\${var.project_name}-\${var.environment}-vpc-flow-logs"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "vpc-flow-logs.amazonaws.com"
      }
    }]
  })

  tags = local.common_tags
}

resource "aws_iam_role_policy" "flow_logs" {
  count = var.enable_flow_logs ? 1 : 0
  name  = "flow-logs-policy"
  role  = aws_iam_role.flow_logs[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents",
        "logs:DescribeLogGroups",
        "logs:DescribeLogStreams"
      ]
      Effect   = "Allow"
      Resource = "*"
    }]
  })
}
`,
  },

  variables: {
    name: 'Terraform Variables',
    description: 'Variable definitions for VPC module',
    language: 'hcl',
    content: `variable "aws_region" {
  description = "AWS region to deploy resources"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Project name for resource naming"
  type        = string
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be dev, staging, or prod"
  }
}

variable "vpc_cidr" {
  description = "CIDR block for VPC"
  type        = string
  default     = "10.0.0.0/16"
  validation {
    condition     = can(cidrhost(var.vpc_cidr, 0))
    error_message = "Must be a valid IPv4 CIDR block"
  }
}

variable "az_count" {
  description = "Number of availability zones"
  type        = number
  default     = 3
  validation {
    condition     = var.az_count >= 2 && var.az_count <= 6
    error_message = "AZ count must be between 2 and 6"
  }
}

variable "enable_nat_gateway" {
  description = "Enable NAT Gateway for private subnets"
  type        = bool
  default     = true
}

variable "enable_flow_logs" {
  description = "Enable VPC Flow Logs"
  type        = bool
  default     = true
}
`,
  },

  outputs: {
    name: 'Terraform Outputs',
    description: 'Output values for use by other modules',
    language: 'hcl',
    content: `output "vpc_id" {
  description = "ID of the VPC"
  value       = aws_vpc.main.id
}

output "vpc_cidr" {
  description = "CIDR block of the VPC"
  value       = aws_vpc.main.cidr_block
}

output "public_subnet_ids" {
  description = "IDs of public subnets"
  value       = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  description = "IDs of private subnets"
  value       = aws_subnet.private[*].id
}

output "public_subnet_cidrs" {
  description = "CIDR blocks of public subnets"
  value       = aws_subnet.public[*].cidr_block
}

output "private_subnet_cidrs" {
  description = "CIDR blocks of private subnets"
  value       = aws_subnet.private[*].cidr_block
}

output "internet_gateway_id" {
  description = "ID of the Internet Gateway"
  value       = aws_internet_gateway.main.id
}

output "nat_gateway_ids" {
  description = "IDs of NAT Gateways"
  value       = aws_nat_gateway.main[*].id
}

output "availability_zones" {
  description = "Availability zones used"
  value       = local.availability_zones
}
`,
  },
};

export function getExampleForArtifact(
  containerType: string,
  artifactPath: string
): ArtifactExample | undefined {
  // Extract artifact type from path
  if (containerType === 'orchestration.kubernetes-namespace') {
    if (artifactPath.includes('namespace.yaml')) {
      return KUBERNETES_NAMESPACE_EXAMPLES.namespace;
    } else if (artifactPath.includes('resource-quota.yaml')) {
      return KUBERNETES_NAMESPACE_EXAMPLES.resourceQuota;
    } else if (artifactPath.includes('limit-range.yaml')) {
      return KUBERNETES_NAMESPACE_EXAMPLES.limitRange;
    } else if (artifactPath.includes('network-policy.yaml')) {
      return KUBERNETES_NAMESPACE_EXAMPLES.networkPolicy;
    } else if (artifactPath.includes('rbac.yaml')) {
      return KUBERNETES_NAMESPACE_EXAMPLES.rbac;
    }
  } else if (containerType === 'orchestration.docker-compose') {
    if (artifactPath.includes('docker-compose')) {
      return DOCKER_COMPOSE_EXAMPLES.compose;
    }
  } else if (containerType === 'infrastructure.vpc') {
    if (artifactPath.includes('main.tf')) {
      return TERRAFORM_VPC_EXAMPLES.main;
    } else if (artifactPath.includes('variables.tf')) {
      return TERRAFORM_VPC_EXAMPLES.variables;
    } else if (artifactPath.includes('outputs.tf')) {
      return TERRAFORM_VPC_EXAMPLES.outputs;
    }
  }

  return undefined;
}
