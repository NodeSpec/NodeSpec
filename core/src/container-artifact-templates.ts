/**
 * Container-specific artifact templates for infrastructure and orchestration nodes
 * These are language-agnostic configurations that can be used across any contained application
 */

import type { ArtifactPlaceholder } from './templates.js';
import { resolveContainerRoleId } from './container-types.js';

export interface ContainerArtifactContext {
  containerId: string;
  containerType: string;
  metadata?: Record<string, unknown>;
  childNodeTypes?: string[];
}

export function generateContainerArtifacts(
  context: ContainerArtifactContext
): ArtifactPlaceholder[] {
  const { containerType } = context;

  switch (containerType) {
    case 'infrastructure.azure-vnet':
      return generateAzureVNetArtifacts(context);
    case 'infrastructure.gcp-vpc':
      return generateGCPVPCArtifacts(context);
  }

  const roleId = resolveContainerRoleId(containerType);

  switch (roleId) {
    case 'vpc':
      return generateVPCArtifacts(context);
    case 'k8s-cluster':
      return generateK8sClusterArtifacts(context);
    case 'k8s-namespace':
      return generateK8sNamespaceArtifacts(context);
    case 'docker-compose':
      return generateDockerComposeArtifacts(context);
    case 'microservice-boundary':
      return generateMicroserviceBoundaryArtifacts(context);
    // N10(c) 2026-08-09: the 'service-mesh' case is gone — the role is a Networking
    // LEAF now (migration 20260810100000) and its Istio/Linkerd file suggestions
    // moved to the istio/linkerd catalog rows' suggested_files.
    case 'embedded-system':
      return generateEmbeddedSystemArtifacts(context);
    case 'desktop-app':
      return generateDesktopAppArtifacts(context);
    default:
      return [];
  }
}

// ============================================
// INFRASTRUCTURE LAYER - VPC/NETWORKING
// ============================================

function generateVPCArtifacts(_context: ContainerArtifactContext): ArtifactPlaceholder[] {
  return [
    {
      kind: 'config',
      suggestedPath: 'infrastructure/vpc/main.tf',
      description: 'Terraform VPC infrastructure definition',
      language: 'hcl',
    },
    {
      kind: 'config',
      suggestedPath: 'infrastructure/vpc/variables.tf',
      description: 'Terraform variables for VPC configuration',
      language: 'hcl',
    },
    {
      kind: 'config',
      suggestedPath: 'infrastructure/vpc/outputs.tf',
      description: 'Terraform outputs for VPC resources',
      language: 'hcl',
    },
    {
      kind: 'config',
      suggestedPath: 'infrastructure/vpc/cloudformation.yaml',
      description: 'AWS CloudFormation VPC stack template',
      language: 'yaml',
    },
    {
      kind: 'config',
      suggestedPath: 'infrastructure/vpc/cdk-stack.ts',
      description: 'AWS CDK VPC stack definition (TypeScript)',
      language: 'typescript',
    },
    {
      kind: 'config',
      suggestedPath: 'infrastructure/vpc/pulumi-stack.ts',
      description: 'Pulumi VPC infrastructure (TypeScript)',
      language: 'typescript',
    },
    {
      kind: 'config',
      suggestedPath: 'infrastructure/vpc/deploy.sh',
      description: 'Deployment script for VPC infrastructure',
      language: 'shell',
    },
  ];
}

function generateAzureVNetArtifacts(_context: ContainerArtifactContext): ArtifactPlaceholder[] {
  return [
    {
      kind: 'config',
      suggestedPath: 'infrastructure/vnet/main.tf',
      description: 'Terraform Azure VNet configuration',
      language: 'hcl',
    },
    {
      kind: 'config',
      suggestedPath: 'infrastructure/vnet/azuredeploy.json',
      description: 'Azure Resource Manager (ARM) template',
      language: 'json',
    },
    {
      kind: 'config',
      suggestedPath: 'infrastructure/vnet/bicep-deployment.bicep',
      description: 'Azure Bicep VNet deployment',
      language: 'bicep',
    },
    {
      kind: 'config',
      suggestedPath: 'infrastructure/vnet/variables.tf',
      description: 'Terraform variables for VNet',
      language: 'hcl',
    },
    {
      kind: 'config',
      suggestedPath: 'infrastructure/vnet/deploy.sh',
      description: 'Azure CLI deployment script',
      language: 'shell',
    },
  ];
}

function generateGCPVPCArtifacts(_context: ContainerArtifactContext): ArtifactPlaceholder[] {
  return [
    {
      kind: 'config',
      suggestedPath: 'infrastructure/vpc/main.tf',
      description: 'Terraform GCP VPC configuration',
      language: 'hcl',
    },
    {
      kind: 'config',
      suggestedPath: 'infrastructure/vpc/deployment-manager.yaml',
      description: 'GCP Deployment Manager template',
      language: 'yaml',
    },
    {
      kind: 'config',
      suggestedPath: 'infrastructure/vpc/gcloud-commands.sh',
      description: 'gcloud CLI commands for VPC setup',
      language: 'shell',
    },
    {
      kind: 'config',
      suggestedPath: 'infrastructure/vpc/variables.tf',
      description: 'Terraform variables',
      language: 'hcl',
    },
  ];
}

// ============================================
// ORCHESTRATION LAYER - KUBERNETES
// ============================================

function generateK8sClusterArtifacts(_context: ContainerArtifactContext): ArtifactPlaceholder[] {

  return [
    {
      kind: 'config',
      suggestedPath: 'kubernetes/cluster/eksctl-config.yaml',
      description: 'EKS cluster configuration (eksctl)',
      language: 'yaml',
    },
    {
      kind: 'config',
      suggestedPath: 'kubernetes/cluster/aks-config.yaml',
      description: 'AKS cluster configuration',
      language: 'yaml',
    },
    {
      kind: 'config',
      suggestedPath: 'kubernetes/cluster/gke-config.yaml',
      description: 'GKE cluster configuration',
      language: 'yaml',
    },
    {
      kind: 'config',
      suggestedPath: 'kubernetes/cluster/terraform-eks.tf',
      description: 'Terraform EKS cluster definition',
      language: 'hcl',
    },
    {
      kind: 'config',
      suggestedPath: 'kubernetes/cluster/kops-cluster.yaml',
      description: 'kops cluster specification',
      language: 'yaml',
    },
    {
      kind: 'config',
      suggestedPath: 'kubernetes/addons/ingress-nginx.yaml',
      description: 'NGINX Ingress Controller installation',
      language: 'yaml',
    },
    {
      kind: 'config',
      suggestedPath: 'kubernetes/addons/cert-manager.yaml',
      description: 'Cert Manager for automatic TLS certificates',
      language: 'yaml',
    },
    {
      kind: 'config',
      suggestedPath: 'kubernetes/addons/cluster-autoscaler.yaml',
      description: 'Cluster Autoscaler configuration',
      language: 'yaml',
    },
    {
      kind: 'config',
      suggestedPath: 'kubernetes/addons/prometheus-stack.yaml',
      description: 'Prometheus monitoring stack (Helm values)',
      language: 'yaml',
    },
    {
      kind: 'config',
      suggestedPath: 'kubernetes/rbac/cluster-roles.yaml',
      description: 'Cluster-wide RBAC roles',
      language: 'yaml',
    },
    {
      kind: 'config',
      suggestedPath: 'kubernetes/scripts/bootstrap-cluster.sh',
      description: 'Cluster bootstrap and addon installation script',
      language: 'shell',
    },
    {
      kind: 'config',
      suggestedPath: 'kubernetes/scripts/kubeconfig-setup.sh',
      description: 'kubectl configuration setup',
      language: 'shell',
    },
  ];
}

function generateK8sNamespaceArtifacts(context: ContainerArtifactContext): ArtifactPlaceholder[] {
  const metadata = context.metadata || {};
  const namespaceName = (metadata.name as string) || 'production';

  return [
    {
      kind: 'config',
      suggestedPath: `kubernetes/namespaces/${namespaceName}/namespace.yaml`,
      description: 'Kubernetes namespace definition with labels',
      language: 'yaml',
    },
    {
      kind: 'config',
      suggestedPath: `kubernetes/namespaces/${namespaceName}/resource-quota.yaml`,
      description: 'ResourceQuota for CPU, memory, and storage limits',
      language: 'yaml',
    },
    {
      kind: 'config',
      suggestedPath: `kubernetes/namespaces/${namespaceName}/limit-range.yaml`,
      description: 'LimitRange for default resource requests/limits per pod',
      language: 'yaml',
    },
    {
      kind: 'config',
      suggestedPath: `kubernetes/namespaces/${namespaceName}/network-policy.yaml`,
      description: 'NetworkPolicy for ingress/egress traffic control',
      language: 'yaml',
    },
    {
      kind: 'config',
      suggestedPath: `kubernetes/namespaces/${namespaceName}/rbac.yaml`,
      description: 'Role and RoleBinding for namespace-scoped permissions',
      language: 'yaml',
    },
    {
      kind: 'config',
      suggestedPath: `kubernetes/namespaces/${namespaceName}/service-account.yaml`,
      description: 'ServiceAccount for pod identity',
      language: 'yaml',
    },
    {
      kind: 'config',
      suggestedPath: `kubernetes/namespaces/${namespaceName}/pod-security-policy.yaml`,
      description: 'PodSecurityPolicy for security constraints',
      language: 'yaml',
    },
    {
      kind: 'config',
      suggestedPath: `kubernetes/namespaces/${namespaceName}/kustomization.yaml`,
      description: 'Kustomize base configuration for namespace resources',
      language: 'yaml',
    },
    {
      kind: 'config',
      suggestedPath: `kubernetes/namespaces/${namespaceName}/apply.sh`,
      description: 'Script to apply all namespace resources',
      language: 'shell',
    },
  ];
}

function generateDockerComposeArtifacts(_context: ContainerArtifactContext): ArtifactPlaceholder[] {
  return [
    {
      kind: 'config',
      suggestedPath: 'docker-compose.yml',
      description: 'Docker Compose service definitions',
      language: 'yaml',
    },
    {
      kind: 'config',
      suggestedPath: 'docker-compose.prod.yml',
      description: 'Production overrides for Docker Compose',
      language: 'yaml',
    },
    {
      kind: 'config',
      suggestedPath: 'docker-compose.dev.yml',
      description: 'Development overrides (hot reload, debug ports)',
      language: 'yaml',
    },
    {
      kind: 'config',
      suggestedPath: '.env.example',
      description: 'Environment variables template',
      language: 'text',
    },
    {
      kind: 'config',
      suggestedPath: 'docker/nginx/nginx.conf',
      description: 'NGINX reverse proxy configuration',
      language: 'nginx',
    },
    {
      kind: 'config',
      suggestedPath: 'scripts/docker-entrypoint.sh',
      description: 'Container entrypoint script',
      language: 'shell',
    },
    {
      kind: 'config',
      suggestedPath: 'scripts/healthcheck.sh',
      description: 'Container health check script',
      language: 'shell',
    },
    {
      kind: 'doc',
      suggestedPath: 'docs/docker-setup.md',
      description: 'Docker Compose setup and usage guide',
      language: 'markdown',
    },
  ];
}

// ============================================
// LOGICAL BOUNDARIES - MICROSERVICES
// ============================================

function generateMicroserviceBoundaryArtifacts(context: ContainerArtifactContext): ArtifactPlaceholder[] {
  const metadata = context.metadata || {};
  const domain = (metadata.domain as string) || 'service';

  return [
    {
      kind: 'config',
      suggestedPath: `services/${domain}/api-contract.yaml`,
      description: 'OpenAPI 3.0 API contract specification',
      language: 'yaml',
    },
    {
      kind: 'config',
      suggestedPath: `services/${domain}/proto/service.proto`,
      description: 'gRPC Protocol Buffer definitions',
      language: 'protobuf',
    },
    {
      kind: 'config',
      suggestedPath: `services/${domain}/graphql/schema.graphql`,
      description: 'GraphQL schema definition',
      language: 'graphql',
    },
    {
      kind: 'config',
      suggestedPath: `services/${domain}/kubernetes/deployment.yaml`,
      description: 'Kubernetes Deployment manifest',
      language: 'yaml',
    },
    {
      kind: 'config',
      suggestedPath: `services/${domain}/kubernetes/service.yaml`,
      description: 'Kubernetes Service (ClusterIP/LoadBalancer)',
      language: 'yaml',
    },
    {
      kind: 'config',
      suggestedPath: `services/${domain}/kubernetes/hpa.yaml`,
      description: 'HorizontalPodAutoscaler for auto-scaling',
      language: 'yaml',
    },
    {
      kind: 'config',
      suggestedPath: `services/${domain}/kubernetes/configmap.yaml`,
      description: 'ConfigMap for configuration data',
      language: 'yaml',
    },
    {
      kind: 'config',
      suggestedPath: `services/${domain}/kubernetes/secrets.yaml`,
      description: 'Secrets manifest (encrypted at rest)',
      language: 'yaml',
    },
    {
      kind: 'config',
      suggestedPath: `services/${domain}/.gitlab-ci.yml`,
      description: 'GitLab CI/CD pipeline',
      language: 'yaml',
    },
    {
      kind: 'config',
      suggestedPath: `services/${domain}/.github/workflows/ci-cd.yml`,
      description: 'GitHub Actions CI/CD workflow',
      language: 'yaml',
    },
    {
      kind: 'config',
      suggestedPath: `services/${domain}/Dockerfile`,
      description: 'Multi-stage Dockerfile for production',
      language: 'dockerfile',
    },
    {
      kind: 'config',
      suggestedPath: `services/${domain}/.dockerignore`,
      description: 'Docker build context ignore patterns',
      language: 'text',
    },
    {
      kind: 'doc',
      suggestedPath: `services/${domain}/README.md`,
      description: 'Service documentation and architecture overview',
      language: 'markdown',
    },
  ];
}

// ============================================
// EMBEDDED SYSTEMS
// ============================================

function generateEmbeddedSystemArtifacts(_context: ContainerArtifactContext): ArtifactPlaceholder[] {

  return [
    {
      kind: 'config',
      suggestedPath: 'embedded/hardware/board-config.dts',
      description: 'Device Tree Source for hardware configuration',
      language: 'c',
    },
    {
      kind: 'config',
      suggestedPath: 'embedded/firmware/Makefile',
      description: 'Firmware build system',
      language: 'makefile',
    },
    {
      kind: 'config',
      suggestedPath: 'embedded/firmware/linker-script.ld',
      description: 'Linker script for memory layout',
      language: 'c',
    },
    {
      kind: 'config',
      suggestedPath: 'embedded/firmware/platformio.ini',
      description: 'PlatformIO configuration for embedded development',
      language: 'ini',
    },
    {
      kind: 'config',
      suggestedPath: 'embedded/firmware/CMakeLists.txt',
      description: 'CMake build configuration',
      language: 'cmake',
    },
    {
      kind: 'source',
      suggestedPath: 'embedded/firmware/src/main.c',
      description: 'Main firmware entry point',
      language: 'c',
    },
    {
      kind: 'source',
      suggestedPath: 'embedded/firmware/src/board.h',
      description: 'Board-specific definitions and pin mappings',
      language: 'c',
    },
    {
      kind: 'source',
      suggestedPath: 'embedded/drivers/hal_init.c',
      description: 'Hardware Abstraction Layer initialization',
      language: 'c',
    },
    {
      kind: 'config',
      suggestedPath: 'embedded/rtos/FreeRTOSConfig.h',
      description: 'FreeRTOS configuration',
      language: 'c',
    },
    {
      kind: 'config',
      suggestedPath: 'embedded/bootloader/bootloader.ld',
      description: 'Bootloader linker script',
      language: 'c',
    },
    {
      kind: 'config',
      suggestedPath: 'embedded/scripts/flash.sh',
      description: 'Firmware flashing script (OpenOCD/J-Link)',
      language: 'shell',
    },
    {
      kind: 'config',
      suggestedPath: 'embedded/scripts/debug.sh',
      description: 'GDB debugging session setup',
      language: 'shell',
    },
    {
      kind: 'config',
      suggestedPath: 'embedded/testing/unity_config.h',
      description: 'Unity testing framework configuration',
      language: 'c',
    },
    {
      kind: 'doc',
      suggestedPath: 'embedded/docs/memory-map.md',
      description: 'System memory map documentation',
      language: 'markdown',
    },
    {
      kind: 'doc',
      suggestedPath: 'embedded/docs/board-bringup.md',
      description: 'Hardware bring-up and validation procedures',
      language: 'markdown',
    },
  ];
}

// ============================================
// RUNTIME LAYER - DESKTOP APPLICATIONS
// ============================================

function generateDesktopAppArtifacts(context: ContainerArtifactContext): ArtifactPlaceholder[] {
  const metadata = context.metadata || {};
  const framework = (metadata.framework as string) || 'electron';

  switch (framework) {
    case 'electron':
      return generateElectronArtifacts();
    case 'tauri':
      return generateTauriArtifacts();
    case 'maui':
      return generateMauiArtifacts();
    default:
      return generateElectronArtifacts();
  }
}

function generateElectronArtifacts(): ArtifactPlaceholder[] {
  return [
    {
      kind: 'source',
      suggestedPath: 'src/main/index.ts',
      description: 'Electron main process entry point',
      language: 'typescript',
    },
    {
      kind: 'source',
      suggestedPath: 'src/preload/index.ts',
      description: 'Preload script for secure IPC bridge between main and renderer',
      language: 'typescript',
    },
    {
      kind: 'source',
      suggestedPath: 'src/main/ipc-handlers.ts',
      description: 'IPC message handlers for main process APIs',
      language: 'typescript',
    },
    {
      kind: 'source',
      suggestedPath: 'src/main/updater.ts',
      description: 'Auto-update logic using electron-updater',
      language: 'typescript',
    },
    {
      kind: 'config',
      suggestedPath: 'electron-builder.json',
      description: 'electron-builder configuration for all platform targets',
      language: 'json',
    },
    {
      kind: 'config',
      suggestedPath: 'electron.vite.config.ts',
      description: 'Electron Vite build configuration',
      language: 'typescript',
    },
    {
      kind: 'config',
      suggestedPath: 'build/entitlements.mac.plist',
      description: 'macOS entitlements for hardened runtime and notarization',
      language: 'xml',
    },
    {
      kind: 'config',
      suggestedPath: 'build/installer.nsh',
      description: 'NSIS custom installer script for Windows',
    },
  ];
}

function generateTauriArtifacts(): ArtifactPlaceholder[] {
  return [
    {
      kind: 'config',
      suggestedPath: 'src-tauri/tauri.conf.json',
      description: 'Tauri application configuration (windows, security, bundler)',
      language: 'json',
    },
    {
      kind: 'source',
      suggestedPath: 'src-tauri/src/main.rs',
      description: 'Tauri Rust backend entry point',
      language: 'rust',
    },
    {
      kind: 'source',
      suggestedPath: 'src-tauri/src/commands.rs',
      description: 'Tauri command handlers invoked from frontend',
      language: 'rust',
    },
    {
      kind: 'config',
      suggestedPath: 'src-tauri/Cargo.toml',
      description: 'Rust dependencies for the Tauri sidecar',
      language: 'toml',
    },
    {
      kind: 'config',
      suggestedPath: 'src-tauri/capabilities/default.json',
      description: 'Tauri v2 capability permissions for IPC and system access',
      language: 'json',
    },
    {
      kind: 'config',
      suggestedPath: 'src-tauri/icons/icon.png',
      description: 'Application icon source used for all platform targets',
    },
    {
      kind: 'config',
      suggestedPath: 'src-tauri/build.rs',
      description: 'Tauri build script for compile-time setup',
      language: 'rust',
    },
  ];
}

function generateMauiArtifacts(): ArtifactPlaceholder[] {
  return [
    {
      kind: 'config',
      suggestedPath: 'App.csproj',
      description: '.NET MAUI project file with target frameworks and NuGet dependencies',
      language: 'xml',
    },
    {
      kind: 'source',
      suggestedPath: 'MauiProgram.cs',
      description: 'MAUI application builder and service registration',
      language: 'csharp',
    },
    {
      kind: 'source',
      suggestedPath: 'App.xaml.cs',
      description: 'Application lifecycle and shell configuration',
      language: 'csharp',
    },
    {
      kind: 'config',
      suggestedPath: 'Platforms/Windows/Package.appxmanifest',
      description: 'Windows MSIX packaging manifest for MAUI app',
      language: 'xml',
    },
    {
      kind: 'config',
      suggestedPath: 'Platforms/MacCatalyst/Info.plist',
      description: 'macOS Catalyst bundle configuration',
      language: 'xml',
    },
    {
      kind: 'config',
      suggestedPath: 'Platforms/MacCatalyst/Entitlements.plist',
      description: 'macOS entitlements for sandbox and system access',
      language: 'xml',
    },
    {
      kind: 'config',
      suggestedPath: 'Properties/launchSettings.json',
      description: 'Debug launch profiles for each target platform',
      language: 'json',
    },
  ];
}
