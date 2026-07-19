import React, { useState } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowLeft, Link2, Upload } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { uploadApi } from "../lib/api/uploadApi";
import { useRemakeStore } from "../stores/useRemakeStore";

export function RemakeNewPage() {
  const navigate = useNavigate();
  const createJob = useRemakeStore((s) => s.createJob);
  const error = useRemakeStore((s) => s.error);
  const loading = useRemakeStore((s) => s.loading);

  const [sourceUrl, setSourceUrl] = useState("");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [localError, setLocalError] = useState("");

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLocalError("");

    if (!sourceUrl.trim() && !videoFile) {
      setLocalError("请粘贴 TikTok 链接或上传视频文件");
      return;
    }

    try {
      let videoKey: string | undefined;
      if (videoFile) {
        setUploading(true);
        const ext = videoFile.name.split(".").pop() || "mp4";
        const key = `remake/source/${crypto.randomUUID()}.${ext}`;
        const uploaded = await uploadApi.uploadLocalFile({
          key,
          file: videoFile,
          contentType: videoFile.type || "video/mp4",
        });
        videoKey = uploaded.key;
        setUploading(false);
      }

      const job = await createJob({
        sourceUrl: sourceUrl.trim() || undefined,
        videoKey,
      });
      navigate(`/app/remake/${job.id}`);
    } catch (submitError) {
      setUploading(false);
      setLocalError(submitError instanceof Error ? submitError.message : "创建任务失败");
    }
  };

  const busy = loading || uploading;

  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col overflow-y-auto p-4 sm:p-6 lg:p-8">
      <div className="mb-6">
        <Link to="/app/remake" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          返回任务列表
        </Link>
        <h1 className="text-[22px] font-extrabold tracking-tight sm:text-[24px]">新建复刻任务</h1>
        <p className="mt-1 text-sm text-muted-foreground">支持 TikTok 链接或本地上传，系统将自动拆解并复刻</p>
      </div>

      <form onSubmit={(event) => void handleSubmit(event)} className="space-y-6 rounded-xl border border-border bg-card p-5 sm:p-6">
        <div className="space-y-2">
          <Label htmlFor="sourceUrl" className="flex items-center gap-2">
            <Link2 className="h-4 w-4" />
            TikTok 链接
          </Label>
          <Input
            id="sourceUrl"
            placeholder="https://www.tiktok.com/@user/video/..."
            value={sourceUrl}
            onChange={(event) => setSourceUrl(event.target.value)}
            disabled={busy}
          />
        </div>

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <div className="h-px flex-1 bg-border" />
          或
          <div className="h-px flex-1 bg-border" />
        </div>

        <div className="space-y-2">
          <Label htmlFor="videoFile" className="flex items-center gap-2">
            <Upload className="h-4 w-4" />
            上传视频
          </Label>
          <Input
            id="videoFile"
            type="file"
            accept="video/*"
            onChange={(event) => setVideoFile(event.target.files?.[0] ?? null)}
            disabled={busy}
          />
          {videoFile && (
            <p className="text-xs text-muted-foreground">已选择：{videoFile.name}</p>
          )}
        </div>

        {(localError || error) && (
          <div className="rounded-lg border border-[#7f1d1d] bg-[#3f1f25] px-4 py-3 text-sm text-[#fca5a5]">
            {localError || error}
          </div>
        )}

        <Button type="submit" className="w-full" disabled={busy}>
          {uploading ? "上传中..." : loading ? "创建中..." : "开始复刻"}
        </Button>
      </form>
    </div>
  );
}
