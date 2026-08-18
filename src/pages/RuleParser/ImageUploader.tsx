import { useCallback, useRef, useState } from 'react';
import { Upload, Image as ImageIcon, X, ZoomIn, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { capabilityClient } from '@lark-apaas/client-toolkit-lite';
import { logger } from '@lark-apaas/client-toolkit-lite';
import { Image } from '@/components/ui/image';

const PLUGIN_ID = 'airline_ticket_rule_image_recognition_1';

interface ImageUploaderProps {
  onRecognizeStart: () => void;
  onRecognizeChunk: (chunk: string) => void;
  onRecognizeComplete: (rawText: string, success: boolean) => void;
  imageFile: File | null;
  setImageFile: (file: File | null) => void;
  imagePreview: string | null;
  setImagePreview: (url: string | null) => void;
  isRecognizing: boolean;
}

export default function ImageUploader({
  onRecognizeStart,
  onRecognizeChunk,
  onRecognizeComplete,
  imageFile,
  setImageFile,
  imagePreview,
  setImagePreview,
  isRecognizing,
}: ImageUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('请上传图片文件（jpg/png/webp）');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast.error('图片大小不能超过 20MB');
      return;
    }
    setImageFile(file);
    const url = URL.createObjectURL(file);
    setImagePreview(url);
  }, [setImageFile, setImagePreview]);

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = () => setIsDragging(false);

  const handleClear = () => {
    setImageFile(null);
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImagePreview(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const handleRecognize = async () => {
    if (!imageFile) {
      toast.error('请先上传票规图片');
      return;
    }

    onRecognizeStart();
    let fullText = '';

    try {
      const executor = (capabilityClient as any).load(PLUGIN_ID);
      const stream = (executor as any).callStream('imageUnderstanding', {
        ticket_rule_images: [imageFile],
      });

      for await (const chunk of stream) {
        const piece = chunk.content ?? chunk.response ?? '';
        if (piece) {
          fullText += piece;
          onRecognizeChunk(piece);
        }
      }

      onRecognizeComplete(fullText, true);
      toast.success('识别完成，请核对结果');
    } catch (err) {
      logger.error('票规识别失败:', String(err));
      toast.error('识别失败，请重试或手动输入数据');
      onRecognizeComplete(fullText, false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <ImageIcon className="size-4 text-primary" />
          票规图片上传
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!imagePreview ? (
          <div
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onClick={() => inputRef.current?.click()}
            className={`
              border-2 border-dashed rounded-xl p-8
              flex flex-col items-center justify-center gap-3
              cursor-pointer transition-all
              ${isDragging
                ? 'border-primary bg-primary/5'
                : 'border-border hover:border-primary/50 hover:bg-muted/30'
              }
            `}
          >
            <div className="size-12 rounded-full bg-primary/10 flex items-center justify-center">
              <Upload className="size-6 text-primary" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-foreground">
                点击或拖拽上传票规表格图片
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                支持 jpg / png / webp 格式，最大 20MB
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="relative group rounded-lg overflow-hidden border border-border bg-muted/30">
              <Image
                src={imagePreview}
                alt="票规预览"
                className="w-full max-h-56 object-contain"
              />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowPreview(true)}
                  className="gap-1.5"
                >
                  <ZoomIn className="size-4" />
                  放大查看
                </Button>
              </div>
              <Button
                type="button"
                size="icon"
                variant="secondary"
                onClick={handleClear}
                className="!absolute right-2 top-2 z-20 h-7 w-7 rounded-full shadow-sm"
                aria-label="删除图片"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground truncate">
              {imageFile?.name}
            </p>
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />

        <Button
          type="button"
          className="w-full"
          onClick={handleRecognize}
          disabled={!imageFile || isRecognizing}
        >
          {isRecognizing ? (
            <>
              <Loader2 className="size-4 mr-2 animate-spin" />
              正在识别中...
            </>
          ) : (
            <>开始识别票规</>
          )}
        </Button>
      </CardContent>

      {/* 放大预览 dialog */}
      {showPreview && imagePreview && (
        <div
          className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4"
          onClick={() => setShowPreview(false)}
        >
          <Image
            src={imagePreview}
            alt="放大预览"
            className="max-w-full max-h-full object-contain"
          />
        </div>
      )}
    </Card>
  );
}
