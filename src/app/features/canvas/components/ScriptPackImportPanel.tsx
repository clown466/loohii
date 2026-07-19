/**
 * 从拆剧助手导入（P3-B）：列平台作品库的剧本包 → 一键导入当前项目。
 * 自包含组件：自己拉列表/发导入请求，父组件只需传 projectId 与导入完成回调。
 * 《P0-剧本包格式v1契约》§5.3/§5.4 的前端半。
 */
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, PackageOpen, RefreshCw, X } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { request } from '../../../lib/api/httpClient';

interface ScriptPackListItem {
  id: string;
  name: string;
  episodeCount: number;
  expectedEpisodes?: number;
  incomplete?: boolean;
  sizeBytes?: number;
  createdAt?: string;
  updatedAt?: string;
}

interface ImportResult {
  imported: { episodes: number; scenes: number; characters: number };
  failed: { episode: number; error: string }[];
  warnings: string[];
  firstEpisodeId: string | null;
  incomplete: boolean;
  expectedEpisodes: number;
  packName: string;
}

interface ScriptPackImportPanelProps {
  projectId: string;
  onImported: (firstEpisodeId: string) => void;
  onClose: () => void;
}

function formatSize(sizeBytes?: number): string {
  if (!sizeBytes || !Number.isFinite(sizeBytes) || sizeBytes <= 0) return '';
  if (sizeBytes < 1024 * 1024) return `${Math.round(sizeBytes / 1024)} KB`;
  return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`;
}

export function ScriptPackImportPanel({ projectId, onImported, onClose }: ScriptPackImportPanelProps) {
  const [packs, setPacks] = useState<ScriptPackListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const loadPacks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await request<{ items: ScriptPackListItem[] }>('/api/script-packs');
      setPacks(Array.isArray(data?.items) ? data.items : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '剧本包列表加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPacks();
  }, [loadPacks]);

  const importPack = useCallback(
    async (packId: string) => {
      setImportingId(packId);
      setError(null);
      try {
        const data = await request<ImportResult>(`/api/projects/${encodeURIComponent(projectId)}/import-script-pack`, {
          method: 'POST',
          body: { packId },
        });
        setResult(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : '导入失败');
      } finally {
        setImportingId(null);
      }
    },
    [projectId],
  );

  return (
    <div className="lh-anim-fade fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="lh-anim-modal flex max-h-[80vh] w-[min(560px,100%)] flex-col overflow-hidden rounded-lg border border-zinc-800 bg-[#111113] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-zinc-800 px-4">
          <div className="flex items-center gap-2 text-[16px] font-semibold text-zinc-100">
            <PackageOpen className="h-4 w-4 text-amber-300" />
            从拆剧助手导入
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[13px] text-zinc-400 hover:text-zinc-100"
              disabled={loading || Boolean(importingId)}
              onClick={() => void loadPacks()}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              刷新
            </Button>
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-zinc-500 hover:text-zinc-100" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {error && (
            <div className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-[14px] leading-5 text-red-200">
              {error}
            </div>
          )}

          {result ? (
            <div className="space-y-3">
              <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[15px] text-emerald-200">
                <div className="flex items-center gap-2 font-medium">
                  <CheckCircle2 className="h-4 w-4" />
                  《{result.packName}》导入完成
                </div>
                <div className="mt-1 text-[14px] text-emerald-200/80">
                  {result.imported.episodes} 集 / {result.imported.scenes} 场 / {result.imported.characters} 个角色
                  {result.incomplete && `（剧本未完成，已导入部分；补全后可再次导入覆盖同集）`}
                </div>
              </div>

              {result.failed.length > 0 && (
                <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-[14px] text-red-200">
                  <div className="mb-1 font-medium">{result.failed.length} 集导入失败：</div>
                  {result.failed.map((item) => (
                    <div key={item.episode}>第 {item.episode} 集：{item.error}</div>
                  ))}
                </div>
              )}

              {result.warnings.length > 0 && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[14px] text-amber-200">
                  <div className="mb-1 flex items-center gap-1.5 font-medium">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {result.warnings.length} 条警告：
                  </div>
                  {result.warnings.slice(0, 8).map((warning, index) => (
                    <div key={index}>{warning}</div>
                  ))}
                  {result.warnings.length > 8 && <div>……其余 {result.warnings.length - 8} 条从略</div>}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="secondary" size="sm" className="h-8 border border-border bg-zinc-900 text-zinc-100 hover:bg-layer-4" onClick={() => setResult(null)}>
                  继续导入其它包
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="h-8 bg-amber-500 text-black hover:bg-amber-400"
                  onClick={() => {
                    if (result.firstEpisodeId) onImported(result.firstEpisodeId);
                    onClose();
                  }}
                >
                  查看导入结果
                </Button>
              </div>
            </div>
          ) : loading ? (
            <div className="space-y-2" aria-label="正在加载平台作品库">
              <p className="text-[14px] text-zinc-500">正在加载平台作品库……</p>
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3 rounded-md border border-zinc-800 bg-[#141416] px-3 py-2.5">
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="lh-skeleton h-3.5 w-2/5" />
                    <div className="lh-skeleton h-3 w-3/5" />
                  </div>
                  <div className="lh-skeleton h-7 w-16 shrink-0" />
                </div>
              ))}
            </div>
          ) : packs.length === 0 ? (
            <div className="py-10 text-center text-[15px] leading-6 text-zinc-500">
              平台作品库还没有剧本包。
              <br />
              请先在拆剧助手里使用「发送到 loohii」。
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-[14px] text-zinc-500">
                选择平台作品库中的剧本包导入当前项目：按集写入工作流并自动生成画布节点；重复导入覆盖同集，不会翻倍。
              </p>
              {packs.map((pack) => (
                <div
                  key={pack.id}
                  className={`flex items-center gap-3 rounded-md border px-3 py-2.5 transition-colors ${
                    importingId === pack.id
                      ? 'lh-skeleton border-amber-500/40 bg-amber-500/5'
                      : 'border-zinc-800 bg-[#141416] hover:border-[#34343C]'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-[15px] font-medium text-zinc-100">
                      <span className="truncate">{pack.name}</span>
                      {pack.incomplete && (
                        <span className="shrink-0 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[12px] text-amber-300">
                          {pack.episodeCount}/{pack.expectedEpisodes ?? '?'} 集
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-[13px] text-zinc-500">
                      {pack.episodeCount} 集{formatSize(pack.sizeBytes) ? ` · ${formatSize(pack.sizeBytes)}` : ''}
                      {pack.updatedAt ? ` · 更新于 ${String(pack.updatedAt).slice(0, 10)}` : ''}
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 shrink-0 bg-amber-500 text-black hover:bg-amber-400"
                    disabled={Boolean(importingId)}
                    onClick={() => void importPack(pack.id)}
                  >
                    {importingId === pack.id ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        导入中……
                      </>
                    ) : (
                      '导入'
                    )}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
