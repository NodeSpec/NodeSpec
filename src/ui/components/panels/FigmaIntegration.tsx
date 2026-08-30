import { useState } from 'react';
import type { FrontendMetadata, FigmaSyncedNode } from '@nodespec/core/node-metadata.js';
import { FigmaAPIClient, findComponentNodes, findPageNodes, extractDesignTokens } from '@nodespec/core/figma-integration.js';

interface FigmaIntegrationProps {
  metadata: FrontendMetadata;
  onMetadataUpdate: (updates: Partial<FrontendMetadata>) => void;
}

export function FigmaIntegration({ metadata, onMetadataUpdate }: FigmaIntegrationProps) {
  const [figmaUrl, setFigmaUrl] = useState('');
  const [accessToken, setAccessToken] = useState(metadata.figmaIntegration?.accessToken || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTokenInput, setShowTokenInput] = useState(!accessToken);

  const handleConnect = async () => {
    if (!figmaUrl || !accessToken) {
      setError('Please provide both Figma URL and access token');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const client = new FigmaAPIClient(accessToken);
      const fileKey = client.extractFileKey(figmaUrl);

      if (!fileKey) {
        throw new Error('Invalid Figma URL. Please use a URL like: https://figma.com/file/FILE_KEY/...');
      }

      const file = await client.getFile(fileKey);

      const components = findComponentNodes(file);
      const pages = findPageNodes(file);

      const designTokens = extractDesignTokens(file);

      const syncedNodes: FigmaSyncedNode[] = [];
      const nodeIds: string[] = [];

      for (const component of components.slice(0, 10)) {
        nodeIds.push(component.id);
      }

      for (const page of pages.slice(0, 5)) {
        nodeIds.push(page.id);
      }

      let imageUrls: Record<string, string> = {};
      if (nodeIds.length > 0) {
        try {
          const imagesResponse = await client.getImages(fileKey, nodeIds, {
            format: 'png',
            scale: 2,
          });
          imageUrls = imagesResponse.images;
        } catch (imgError) {
          console.warn('Failed to fetch images:', imgError);
        }
      }

      for (const component of components.slice(0, 10)) {
        syncedNodes.push({
          figmaNodeId: component.id,
          nodeName: component.name,
          nodeType: 'COMPONENT',
          imageUrl: imageUrls[component.id],
          syncedAt: new Date().toISOString(),
          exportFormat: 'png',
          width: component.absoluteBoundingBox?.width,
          height: component.absoluteBoundingBox?.height,
        });
      }

      for (const page of pages.slice(0, 5)) {
        syncedNodes.push({
          figmaNodeId: page.id,
          nodeName: page.name,
          nodeType: 'FRAME',
          imageUrl: imageUrls[page.id],
          syncedAt: new Date().toISOString(),
          exportFormat: 'png',
          width: page.absoluteBoundingBox?.width,
          height: page.absoluteBoundingBox?.height,
        });
      }

      onMetadataUpdate({
        figmaIntegration: {
          fileKey,
          fileUrl: figmaUrl,
          accessToken,
          lastSyncedAt: new Date().toISOString(),
          syncedNodes,
        },
        designTokens,
        pages: pages.slice(0, 5).map(page => ({
          path: `/${page.name.toLowerCase().replace(/\s+/g, '-')}`,
          name: page.name,
          figmaNodeId: page.id,
        })),
        components: components.slice(0, 10).map(comp => ({
          name: comp.name,
          path: `src/components/${comp.name}.tsx`,
          type: 'ui' as const,
          figmaNodeId: comp.id,
        })),
      });

      setShowTokenInput(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect to Figma');
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = () => {
    onMetadataUpdate({
      figmaIntegration: undefined,
      designTokens: undefined,
    });
    setAccessToken('');
    setShowTokenInput(true);
  };

  const handleRefresh = async () => {
    if (metadata.figmaIntegration?.fileUrl && metadata.figmaIntegration?.accessToken) {
      setFigmaUrl(metadata.figmaIntegration.fileUrl);
      setAccessToken(metadata.figmaIntegration.accessToken);
      await handleConnect();
    }
  };

  const isConnected = !!metadata.figmaIntegration?.fileKey;

  return (
    <div className="figma-integration">
      <div className="figma-header">
        <h3 className="figma-title">Figma Integration</h3>
        <div className="figma-status">
          <span className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`} />
          <span className="status-text">{isConnected ? 'Connected' : 'Not Connected'}</span>
        </div>
      </div>

      {!isConnected || showTokenInput ? (
        <div className="figma-connect-form">
          <div className="form-group">
            <label htmlFor="figma-url">Figma File URL</label>
            <input
              id="figma-url"
              type="text"
              value={figmaUrl}
              onChange={(e) => setFigmaUrl(e.target.value)}
              placeholder="https://figma.com/file/..."
              className="figma-input"
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label htmlFor="figma-token">
              Personal Access Token
              <a
                href="https://help.figma.com/hc/en-us/articles/8085703771159-Manage-personal-access-tokens"
                target="_blank"
                rel="noopener noreferrer"
                className="help-link"
              >
                How to get?
              </a>
            </label>
            <input
              id="figma-token"
              type="password"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder="figd_..."
              className="figma-input"
              disabled={loading}
            />
          </div>

          {error && (
            <div className="error-message">{error}</div>
          )}

          <div className="button-group">
            <button
              onClick={handleConnect}
              disabled={loading || !figmaUrl || !accessToken}
              className="btn-primary"
            >
              {loading ? 'Connecting...' : 'Connect to Figma'}
            </button>
            {isConnected && (
              <button
                onClick={() => setShowTokenInput(false)}
                className="btn-secondary"
                disabled={loading}
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="figma-connected">
          <div className="figma-info">
            <div className="info-item">
              <span className="info-label">Last Synced:</span>
              <span className="info-value">
                {metadata.figmaIntegration?.lastSyncedAt
                  ? new Date(metadata.figmaIntegration.lastSyncedAt).toLocaleString()
                  : 'Never'}
              </span>
            </div>
            <div className="info-item">
              <span className="info-label">Components:</span>
              <span className="info-value">
                {metadata.figmaIntegration?.syncedNodes.filter(n => n.nodeType === 'COMPONENT').length || 0}
              </span>
            </div>
            <div className="info-item">
              <span className="info-label">Pages:</span>
              <span className="info-value">
                {metadata.figmaIntegration?.syncedNodes.filter(n => n.nodeType === 'FRAME').length || 0}
              </span>
            </div>
          </div>

          {metadata.figmaIntegration?.syncedNodes && metadata.figmaIntegration.syncedNodes.length > 0 && (
            <div className="synced-nodes">
              <h4>Synced Designs</h4>
              <div className="nodes-grid">
                {metadata.figmaIntegration.syncedNodes.map((node) => (
                  <div key={node.figmaNodeId} className="node-card">
                    {node.imageUrl ? (
                      <img src={node.imageUrl} alt={node.nodeName} className="node-thumbnail" />
                    ) : (
                      <div className="node-placeholder">
                        {node.nodeType === 'COMPONENT' ? '◆' : '□'}
                      </div>
                    )}
                    <div className="node-info">
                      <div className="node-name">{node.nodeName}</div>
                      <div className="node-type">{node.nodeType}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {metadata.designTokens && (
            <div className="design-tokens">
              <h4>Design Tokens</h4>
              {metadata.designTokens.colors && Object.keys(metadata.designTokens.colors).length > 0 && (
                <div className="token-section">
                  <span className="token-label">Colors:</span>
                  <div className="color-chips">
                    {Object.entries(metadata.designTokens.colors).slice(0, 8).map(([name, value]) => (
                      <div key={name} className="color-chip" title={`${name}: ${value}`}>
                        <div className="color-swatch" style={{ backgroundColor: value }} />
                        <span className="color-name">{name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="button-group">
            <button onClick={handleRefresh} disabled={loading} className="btn-secondary">
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>
            <button onClick={() => setShowTokenInput(true)} className="btn-secondary">
              Change Connection
            </button>
            <button onClick={handleDisconnect} className="btn-danger">
              Disconnect
            </button>
          </div>
        </div>
      )}

      <style>{`
        .figma-integration {
          padding: 16px;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          background: #ffffff;
        }

        .figma-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
        }

        .figma-title {
          font-size: 16px;
          font-weight: 600;
          margin: 0;
          color: #111827;
        }

        .figma-status {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .status-indicator {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }

        .status-indicator.connected {
          background: #10b981;
        }

        .status-indicator.disconnected {
          background: #6b7280;
        }

        .status-text {
          font-size: 13px;
          color: #6b7280;
        }

        .figma-connect-form {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .form-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .form-group label {
          font-size: 13px;
          font-weight: 500;
          color: #374151;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .help-link {
          font-size: 12px;
          color: #3b82f6;
          text-decoration: none;
          font-weight: 400;
        }

        .help-link:hover {
          text-decoration: underline;
        }

        .figma-input {
          padding: 8px 12px;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          font-size: 14px;
          font-family: inherit;
          transition: border-color 0.2s;
        }

        .figma-input:focus {
          outline: none;
          border-color: #3b82f6;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
        }

        .figma-input:disabled {
          background: #f3f4f6;
          cursor: not-allowed;
        }

        .error-message {
          padding: 10px 12px;
          background: #fef2f2;
          border: 1px solid #fecaca;
          border-radius: 6px;
          color: #dc2626;
          font-size: 13px;
        }

        .button-group {
          display: flex;
          gap: 8px;
          margin-top: 8px;
        }

        .btn-primary, .btn-secondary, .btn-danger {
          padding: 8px 16px;
          border: none;
          border-radius: 6px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }

        .btn-primary {
          background: #3b82f6;
          color: white;
        }

        .btn-primary:hover:not(:disabled) {
          background: #2563eb;
        }

        .btn-secondary {
          background: #f3f4f6;
          color: #374151;
        }

        .btn-secondary:hover:not(:disabled) {
          background: #e5e7eb;
        }

        .btn-danger {
          background: #fef2f2;
          color: #dc2626;
        }

        .btn-danger:hover:not(:disabled) {
          background: #fee2e2;
        }

        .btn-primary:disabled, .btn-secondary:disabled, .btn-danger:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .figma-connected {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .figma-info {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding: 12px;
          background: #f9fafb;
          border-radius: 6px;
        }

        .info-item {
          display: flex;
          justify-content: space-between;
          font-size: 13px;
        }

        .info-label {
          color: #6b7280;
          font-weight: 500;
        }

        .info-value {
          color: #111827;
        }

        .synced-nodes {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .synced-nodes h4 {
          font-size: 14px;
          font-weight: 600;
          margin: 0;
          color: #111827;
        }

        .nodes-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
          gap: 12px;
        }

        .node-card {
          border: 1px solid #e5e7eb;
          border-radius: 6px;
          overflow: hidden;
          background: white;
          transition: transform 0.2s, box-shadow 0.2s;
        }

        .node-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        }

        .node-thumbnail {
          width: 100%;
          height: 80px;
          object-fit: cover;
          background: #f3f4f6;
        }

        .node-placeholder {
          width: 100%;
          height: 80px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #f3f4f6;
          font-size: 32px;
          color: #9ca3af;
        }

        .node-info {
          padding: 8px;
        }

        .node-name {
          font-size: 12px;
          font-weight: 500;
          color: #111827;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .node-type {
          font-size: 11px;
          color: #6b7280;
          text-transform: lowercase;
        }

        .design-tokens {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .design-tokens h4 {
          font-size: 14px;
          font-weight: 600;
          margin: 0;
          color: #111827;
        }

        .token-section {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .token-label {
          font-size: 13px;
          font-weight: 500;
          color: #6b7280;
        }

        .color-chips {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .color-chip {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
        }

        .color-swatch {
          width: 32px;
          height: 32px;
          border-radius: 4px;
          border: 1px solid #e5e7eb;
          box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
        }

        .color-name {
          font-size: 10px;
          color: #6b7280;
          max-width: 32px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      `}</style>
    </div>
  );
}
