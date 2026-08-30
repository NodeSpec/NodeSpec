import { Handle, Position } from '@xyflow/react';
import type { CodeEntity, CodeVisibility } from '@nodespec/core/code-structure.js';
import { calculateComplexityColor } from '@nodespec/core/code-structure.js';

interface CodeEntityNodeData {
  entity: CodeEntity;
  label: string;
  complexity?: number;
  isExported: boolean;
  visibility?: CodeVisibility;
  parameters?: Array<{ name: string; type?: string }>;
  returnType?: string;
  lineRange?: string;
}

interface CodeEntityNodeProps {
  data: CodeEntityNodeData;
  selected?: boolean;
}

export function ClassNode({ data, selected }: CodeEntityNodeProps) {
  const entity = data.entity;
  const methods = entity.type === 'class' ? entity.dependencies : [];
  const complexityColor = calculateComplexityColor(data.complexity);

  return (
    <div
      className={`
        bg-white dark:bg-gray-800
        border-2 rounded-lg shadow-sm
        min-w-[180px] max-w-[240px]
        ${selected ? 'border-blue-500 ring-2 ring-blue-200 dark:ring-blue-800' : 'border-gray-300 dark:border-gray-600'}
        transition-all hover:shadow-md
      `}
    >
      <Handle type="target" position={Position.Left} className="w-2 h-2" />

      <div className="p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-lg">🏛️</span>
            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
              {data.label}
            </span>
          </div>
          {data.isExported && (
            <span className="text-xs px-1.5 py-0.5 bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 rounded">
              public
            </span>
          )}
        </div>

        {entity.type === 'class' && methods.length > 0 && (
          <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {methods.slice(0, 5).map((method, idx) => (
                <div key={idx} className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400">
                  <span className="text-gray-400">
                    {data.visibility === 'public' ? '●' : data.visibility === 'private' ? '○' : '◐'}
                  </span>
                  <span className="truncate">{method.split('.').pop() || method}</span>
                </div>
              ))}
              {methods.length > 5 && (
                <div className="text-xs text-gray-400 italic">
                  +{methods.length - 5} more
                </div>
              )}
            </div>
          </div>
        )}

        {data.complexity !== undefined && (
          <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-500 dark:text-gray-400">Complexity</span>
              <span
                className="font-semibold px-1.5 py-0.5 rounded"
                style={{
                  backgroundColor: `${complexityColor}20`,
                  color: complexityColor,
                }}
              >
                {data.complexity}
              </span>
            </div>
          </div>
        )}

        {data.lineRange && (
          <div className="mt-1 text-xs text-gray-400">
            Lines {data.lineRange}
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} className="w-2 h-2" />
    </div>
  );
}

export function FunctionNode({ data, selected }: CodeEntityNodeProps) {
  const complexityColor = calculateComplexityColor(data.complexity);
  const paramCount = data.parameters?.length || 0;

  return (
    <div
      className={`
        bg-white dark:bg-gray-800
        border-2 rounded-lg shadow-sm
        min-w-[160px] max-w-[220px]
        ${selected ? 'border-blue-500 ring-2 ring-blue-200 dark:ring-blue-800' : 'border-gray-300 dark:border-gray-600'}
        transition-all hover:shadow-md
      `}
    >
      <Handle type="target" position={Position.Left} className="w-2 h-2" />

      <div className="p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-lg">⚡</span>
            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
              {data.label}
            </span>
          </div>
          {data.isExported && (
            <span className="text-xs px-1.5 py-0.5 bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 rounded">
              exported
            </span>
          )}
        </div>

        <div className="space-y-1">
          {paramCount > 0 && (
            <div className="text-xs text-gray-600 dark:text-gray-400">
              {paramCount} parameter{paramCount !== 1 ? 's' : ''}
            </div>
          )}

          {data.returnType && (
            <div className="text-xs text-gray-600 dark:text-gray-400">
              Returns: <span className="font-mono text-gray-700 dark:text-gray-300">{data.returnType}</span>
            </div>
          )}

          {data.complexity !== undefined && (
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
              <span className="text-xs text-gray-500 dark:text-gray-400">Complexity</span>
              <span
                className="text-xs font-semibold px-1.5 py-0.5 rounded"
                style={{
                  backgroundColor: `${complexityColor}20`,
                  color: complexityColor,
                }}
              >
                {data.complexity}
              </span>
            </div>
          )}
        </div>

        {data.lineRange && (
          <div className="mt-2 text-xs text-gray-400">
            Lines {data.lineRange}
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} className="w-2 h-2" />
    </div>
  );
}

export function MethodNode({ data, selected }: CodeEntityNodeProps) {
  const complexityColor = calculateComplexityColor(data.complexity);

  return (
    <div
      className={`
        bg-white dark:bg-gray-800
        border rounded shadow-sm
        min-w-[140px] max-w-[180px]
        ${selected ? 'border-blue-400 ring-1 ring-blue-200 dark:ring-blue-800' : 'border-gray-300 dark:border-gray-600'}
        transition-all hover:shadow
      `}
    >
      <Handle type="target" position={Position.Left} className="w-1.5 h-1.5" />

      <div className="p-2">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-sm">🔧</span>
          <span className="text-xs font-medium text-gray-900 dark:text-gray-100 truncate">
            {data.label}
          </span>
          {data.visibility && (
            <span className="text-xs text-gray-400">
              {data.visibility === 'public' ? '●' : data.visibility === 'private' ? '○' : '◐'}
            </span>
          )}
        </div>

        {data.complexity !== undefined && (
          <div className="flex items-center gap-1 text-xs">
            <div
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: complexityColor }}
            />
            <span className="text-gray-500 dark:text-gray-400">{data.complexity}</span>
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} className="w-1.5 h-1.5" />
    </div>
  );
}

export function InterfaceNode({ data, selected }: CodeEntityNodeProps) {
  const entity = data.entity;
  const methods = entity.dependencies || [];

  return (
    <div
      className={`
        bg-white dark:bg-gray-800
        border-2 border-dashed rounded-lg shadow-sm
        min-w-[160px] max-w-[200px]
        ${selected ? 'border-purple-500 ring-2 ring-purple-200 dark:ring-purple-800' : 'border-purple-300 dark:border-purple-600'}
        transition-all hover:shadow-md
      `}
    >
      <Handle type="target" position={Position.Left} className="w-2 h-2" />

      <div className="p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-lg">📋</span>
            <span className="text-sm font-semibold text-purple-900 dark:text-purple-100 truncate">
              {data.label}
            </span>
          </div>
        </div>

        {methods.length > 0 && (
          <div className="mt-2 pt-2 border-t border-purple-200 dark:border-purple-700">
            <div className="space-y-1 max-h-24 overflow-y-auto">
              {methods.slice(0, 4).map((method, idx) => (
                <div key={idx} className="text-xs text-gray-600 dark:text-gray-400 truncate">
                  {method.split('.').pop() || method}
                </div>
              ))}
              {methods.length > 4 && (
                <div className="text-xs text-gray-400 italic">
                  +{methods.length - 4} more
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} className="w-2 h-2" />
    </div>
  );
}

export function ModuleNode({ data, selected }: CodeEntityNodeProps) {
  return (
    <div
      className={`
        bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900 dark:to-indigo-900
        border-2 rounded-lg shadow-sm
        min-w-[160px] max-w-[200px]
        ${selected ? 'border-indigo-500 ring-2 ring-indigo-200 dark:ring-indigo-800' : 'border-indigo-300 dark:border-indigo-600'}
        transition-all hover:shadow-md
      `}
    >
      <Handle type="target" position={Position.Left} className="w-2 h-2" />

      <div className="p-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">📦</span>
          <span className="text-sm font-semibold text-indigo-900 dark:text-indigo-100 truncate">
            {data.label}
          </span>
        </div>

        {data.lineRange && (
          <div className="mt-2 text-xs text-indigo-600 dark:text-indigo-300">
            Module
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} className="w-2 h-2" />
    </div>
  );
}
