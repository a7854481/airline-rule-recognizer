import { useState, useRef, useImperativeHandle, forwardRef } from 'react';
import {
  X,
  ZoomIn,
  Loader2,
  FileText,
  Camera,
  ClipboardPaste,
  Zap,
  Grid3X3,
  ChevronDown,
  AlertTriangle,
  MousePointerClick,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { logger } from '@lark-apaas/client-toolkit-lite';
import { Image } from '@/components/ui/image';
import { recognizeTicketRule, parseTicketRuleText } from '@/lib/recognize-client';

export type RecognizeMode = 'focus' | 'full';

export interface InputPanelHandle {
  receivePastedImage: (file: File) => void;
  isImageActive: () => boolean;
  getRootElement: () => HTMLElement | null;
}

interface InputPanelProps {
  onRecognizeStart: (mode: RecognizeMode, targetCabin: string) => void;
  onRecognizeChunk: (chunk: string) => void;
  onRecognizeComplete: (rawText: string, success: boolean, mode: RecognizeMode, targetCabin: string) => void;
  imageFile: File | null;
  setImageFile: (file: File | null) => void;
  imagePreview: string | null;
  setImagePreview: (url: string | null) => void;
  textContent: string;
  setTextContent: (text: string) => void;
  isRecognizing: boolean;
  /** 当前航班信息中的舱位代码，用于聚焦模式 */
  targetCabinCode?: string;
  /** 当前识别模式（受控） */
  recognizeMode: RecognizeMode;
  onRecognizeModeChange: (mode: RecognizeMode) => void;
  /** 当用户在本卡片内交互时触发，用于粘贴图片智能分发 */
  onInteract?: () => void;
}

const InputPanel = forwardRef<InputPanelHandle, InputPanelProps>(function InputPanel(
  {
    onRecognizeStart,
    onRecognizeChunk,
    onRecognizeComplete,
    imageFile,
    setImageFile,
    imagePreview,
    setImagePreview,
    textContent,
    setTextContent,
    isRecognizing,
    targetCabinCode = '',
    recognizeMode,
    onRecognizeModeChange,
    onInteract,
  },
  ref,
) {
  const [tab, setTab] = useState<'image' | 'text'>('image');
  const [showPreview, setShowPreview] = useState(false);
  const [isPasteHighlight, setIsPasteHighlight] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const focusCabin = targetCabinCode.trim().toUpperCase();
  const canFocus = focusCabin.length > 0 && focusCabin.length <= 2;

  useImperativeHandle(ref, () => ({
    receivePastedImage: (file: File) => {
      onInteract?.();
      setTab('image');
      handleFile(file);
      // 粘贴后自动触发识别（默认聚焦模式，无舱位则全量）
      setTimeout(() => {
        const mode: RecognizeMode = canFocus ? 'focus' : 'full';
        recognizeImageFile(file, mode, focusCabin);
      }, 250);
    },
    isImageActive: () => tab === 'image',
    getRootElement: () => rootRef.current,
  }));

  // 粘贴高亮闪烁
  const flashHighlight = () => {
    setIsPasteHighlight(true);
    setTimeout(() => setIsPasteHighlight(false), 900);
  };

  const handlePasteFromClipboard = async () => {
    try {
      if (typeof (navigator.clipboard as any)?.read !== 'function') {
        toast.info('此浏览器不支持点击粘贴，请使用 Ctrl+V / Cmd+V');
        return;
      }
      const items = await (navigator.clipboard as any).read();
      for (const item of items) {
        const types = item.types as string[];
        const imageType = types.find((t: string) => t.startsWith('image/'));
        if (imageType) {
          const blob = (await item.getType(imageType)) as Blob;
          const file = new File([blob], 'clipboard-image.png', { type: imageType });
          onInteract?.();
          handleFile(file);
          // 粘贴后自动触发识别
          setTimeout(() => {
            const mode: RecognizeMode = canFocus ? 'focus' : 'full';
            recognizeImageFile(file, mode, focusCabin);
          }, 250);
          return;
        }
      }
      toast.info('剪贴板中没有图片');
    } catch (err) {
      logger.error('读取剪贴板失败:', String(err));
      toast.error('无法读取剪贴板，请使用 Ctrl+V / Cmd+V 粘贴');
    }
  };

  // ===== 图片文件处理 =====
  const handleFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('请粘贴图片（jpg/png/webp）');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast.error('图片大小不能超过 20MB');
      return;
    }
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImageFile(file);
    const url = URL.createObjectURL(file);
    setImagePreview(url);
    flashHighlight();
  };

  const handleClearImage = () => {
    setImageFile(null);
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImagePreview(null);
  };

  // ===== 图片识别（走同源后端 /api/recognize，密钥在服务端）=====
  const recognizeImageFile = async (file: File, mode: RecognizeMode, targetCabin: string) => {
    onRecognizeStart(mode, targetCabin);
    let fullText = '';
    try {
      // 提示词规则（签转向上继承 / 折扣列校验 / 强制 discount / focus 只出目标舱位）
      // 已内置于后端 server.js，前端只需传图片+模式+目标舱位。
      fullText = await recognizeTicketRule(file, mode, targetCabin);
      onRecognizeComplete(fullText, true, mode, targetCabin);
      toast.success(
        mode === 'focus'
          ? `${targetCabin} 舱识别完成，请核对`
          : '全量舱位识别完成，请核对',
      );
    } catch (err) {
      logger.error('票规图片识别失败:', String(err));
      toast.error(`识别失败：${(err as Error)?.message || '请重试或手动输入数据'}`);
      onRecognizeComplete(fullText, false, mode, targetCabin);
    }
  };

  const handleImageRecognize = (mode: RecognizeMode) => {
    if (!imageFile) {
      toast.error('请先粘贴票规图片');
      return;
    }
    if (mode === 'focus' && !canFocus) {
      toast.error('请先在航班信息中填写舱位代码');
      return;
    }
    recognizeImageFile(imageFile, mode, focusCabin);
  };

  // ===== 文本解析（走同源后端 /api/parse-text）=====
  const handleTextParse = async () => {
    const trimmed = textContent.trim();
    if (!trimmed) {
      toast.error('请粘贴票规文本内容');
      return;
    }
    if (trimmed.length < 10) {
      toast.error('票规文本过短，请粘贴完整的票规内容');
      return;
    }
    onRecognizeStart('full', '');
    let fullText = '';
    try {
      fullText = await parseTicketRuleText(trimmed);
      onRecognizeComplete(fullText, true, 'full', '');
      toast.success('解析完成，请核对结果');
    } catch (err) {
      logger.error('票规文本解析失败:', String(err));
      toast.error(`解析失败：${(err as Error)?.message || '请重试或手动输入数据'}`);
      onRecognizeComplete(fullText, false, 'full', '');
    }
  };

  const progressLabel = (() => {
    if (!isRecognizing) return '';
    if (recognizeMode === 'focus' && focusCabin) {
      return `正在识别 ${focusCabin} 舱费率...`;
    }
    return '正在识别全量舱位...';
  })();

  return (
    <Card ref={rootRef} onClick={onInteract} onFocus={onInteract} className="relative">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Camera className="size-4 text-primary" />
          票规输入
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs value={tab} onValueChange={(v) => setTab(v as 'image' | 'text')}>
          <TabsList className="w-full grid grid-cols-2">
            <TabsTrigger value="image" className="gap-1.5">
              <ClipboardPaste className="size-3.5" />
              图片粘贴
            </TabsTrigger>
            <TabsTrigger value="text" className="gap-1.5">
              <FileText className="size-3.5" />
              文本粘贴
            </TabsTrigger>
          </TabsList>

          {/* 图片粘贴 tab */}
          <TabsContent value="image" className="mt-3 space-y-3">
            {/* 大尺寸粘贴热区 */}
            <div
              className={`
                w-full min-h-[140px] rounded-xl border-2 border-dashed px-5 py-5
                flex items-center justify-center
                transition-all duration-200 select-none
                ${isPasteHighlight
                  ? 'border-primary bg-primary/10'
                  : isRecognizing
                      ? 'border-primary/60 bg-primary/5'
                      : 'border-border bg-muted/20 hover:border-primary/40 hover:bg-muted/30'
                }
              `}
            >
              <AnimatePresence mode="wait">
                {!imagePreview ? (
                  <motion.div
                    key="empty"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.25, ease: 'easeOut' }}
                    className="flex flex-col items-center justify-center gap-3 text-center"
                  >
                    <div className="size-14 rounded-full bg-primary/10 flex items-center justify-center">
                      {isRecognizing ? (
                        <Loader2 className="size-7 text-primary animate-spin" />
                      ) : (
                        <ClipboardPaste className="size-7 text-primary" />
                      )}
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-foreground">
                        {isRecognizing ? progressLabel : 'Ctrl+V 粘贴票规图片'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {isRecognizing
                          ? recognizeMode === 'focus' && focusCabin
                            ? `正在定位 ${focusCabin} 舱行并提取费率，请稍候`
                            : 'AI 正在解析舱位费率表，请稍候'
                          : '在页面任意位置按 Ctrl+V 粘贴图片，自动识别'}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePasteFromClipboard();
                      }}
                      className="gap-1.5 h-7 px-3 text-xs"
                    >
                      <MousePointerClick className="size-3.5" />
                      点击粘贴
                    </Button>
                  </motion.div>
                ) : (
                  <motion.div
                    key="preview"
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.98 }}
                    transition={{ duration: 0.25, ease: 'easeOut' }}
                    className="w-full space-y-2.5"
                  >
                    <div className="relative rounded-lg overflow-hidden border bg-muted/30 group">
                      <Image
                        src={imagePreview}
                        alt="票规预览"
                        className="w-full max-h-52 object-contain"
                      />
                      {isRecognizing && (
                        <div className="absolute inset-0 bg-background/60 backdrop-blur-[2px] flex items-center justify-center">
                          <div className="flex items-center gap-2 bg-card px-3 py-1.5 rounded-full shadow-sm border border-border">
                            <Loader2 className="size-4 text-primary animate-spin" />
                            <span className="text-sm font-medium">{progressLabel}</span>
                          </div>
                        </div>
                      )}
                      <div className="absolute inset-0 bg-black/0 hover:bg-black/20 transition-all flex items-center justify-center opacity-0 hover:opacity-100">
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowPreview(true);
                          }}
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
                        onClick={(e) => {
                          e.stopPropagation();
                          handleClearImage();
                        }}
                        className="!absolute right-2 top-2 z-20 h-7 w-7 rounded-full shadow-sm"
                        aria-label="删除图片"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-muted-foreground truncate">
                        {imageFile?.name || '粘贴图片'}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        再次 Ctrl+V 可替换图片
                      </p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* 识别按钮区 */}
            {imagePreview && !isRecognizing && (
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  className="flex-1 gap-1.5"
                  onClick={() => handleImageRecognize(canFocus ? 'focus' : 'full')}
                  disabled={!imageFile || isRecognizing}
                >
                  {canFocus ? (
                    <>
                      <Zap className="size-4" />
                      仅识别 {focusCabin} 舱（快）
                    </>
                  ) : (
                    <>
                      <Grid3X3 className="size-4" />
                      识别全部舱位
                    </>
                  )}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="shrink-0"
                      aria-label="识别模式"
                    >
                      <ChevronDown className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuItem
                      onClick={() => handleImageRecognize('focus')}
                      disabled={!canFocus || !imageFile}
                      className="gap-2"
                    >
                      <Zap className="size-4 text-primary" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium">
                          仅识别 {focusCabin || '?'} 舱（快速）
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          只提取目标舱位行，速度快 3-5 倍
                        </div>
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => handleImageRecognize('full')}
                      disabled={!imageFile}
                      className="gap-2"
                    >
                      <Grid3X3 className="size-4 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium">识别全部舱位（完整）</div>
                        <div className="text-[11px] text-muted-foreground">
                          提取所有舱位的费率和规则
                        </div>
                      </div>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}

            {/* 无舱位提醒 */}
            {!canFocus && !isRecognizing && imagePreview && (
              <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2">
                <AlertTriangle className="size-4 text-warning shrink-0 mt-0.5" />
                <div className="text-[11px] text-warning-foreground/90">
                  航班信息中的舱位代码为空，默认进行全量识别。
                  <br />
                  填写舱位代码可使用快速聚焦模式，识别速度提升数倍。
                </div>
              </div>
            )}
          </TabsContent>

          {/* 文本粘贴 tab */}
          <TabsContent value="text" className="mt-3 space-y-3">
            <Textarea
              value={textContent}
              onChange={(e) => setTextContent(e.target.value)}
              placeholder="粘贴票规文本，支持舱位费率表、退改签规则等...&#10;&#10;示例：&#10;舱位等级：Y/B/M/E/K/H/L/N/V/U&#10;自愿退票：&#10;- 起飞前30天（含）之前：免费&#10;- 起飞前30天-7天：10%&#10;- 起飞前7天-48小时：20%&#10;- 起飞前48小时-4小时：50%&#10;- 起飞前4小时-起飞后：不得退票&#10;自愿变更：&#10;- 起飞前30天（含）之前：免费&#10;- 起飞前30天-7天：5%&#10;自愿签转：不允许&#10;OPEN票：有效期1年"
              className="min-h-[200px] resize-y font-mono text-sm leading-relaxed"
              disabled={isRecognizing}
            />

            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {textContent.length} 字符
              </span>
              <Button
                type="button"
                onClick={handleTextParse}
                disabled={isRecognizing || !textContent.trim()}
              >
                {isRecognizing ? (
                  <>
                    <Loader2 className="size-4 mr-2 animate-spin" />
                    正在解析中...
                  </>
                ) : (
                  <>开始解析文本</>
                )}
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>

      {/* 放大预览 */}
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
});

export default InputPanel;
