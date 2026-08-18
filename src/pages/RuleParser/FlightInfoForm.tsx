import { useState, useRef, useImperativeHandle, forwardRef } from 'react';
import { PlaneTakeoff, CalendarDays, X, Loader2, ClipboardPaste, MousePointerClick } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { logger } from '@lark-apaas/client-toolkit-lite';
import type { IFlightInfo } from '@/data/flight-info';
import { Image } from '@/components/ui/image';
import {
  AIRLINE_CODE_MAP,
  extractAirlineCodeFromFlightNo,
  getAirlineNameByCode,
} from '@/data/airline-codes';
import { recognizeFlightInfo } from '@/lib/recognize-client';

export interface FlightInfoFormHandle {
  receivePastedImage: (file: File) => void;
  isActive: () => boolean;
  getRootElement: () => HTMLElement | null;
}

interface FlightInfoFormProps {
  flightInfo: IFlightInfo;
  onChange: (info: IFlightInfo) => void;
  /** 当用户在本卡片内交互时触发，用于粘贴图片智能分发 */
  onInteract?: () => void;
}

/**
 * 根据航班号 + AI 识别结果解析航司名称
 * 优先使用 AI 直接识别的航司名称，其次通过二字码映射表匹配
 */
function resolveAirlineName(flightNo: string, aiName?: string): string {
  if (aiName && aiName.trim()) return aiName.trim();
  const { name } = extractAirlineCodeFromFlightNo(flightNo);
  return name;
}

const FlightInfoForm = forwardRef<FlightInfoFormHandle, FlightInfoFormProps>(
  function FlightInfoForm({ flightInfo, onChange, onInteract }, ref) {
    const [flightImage, setFlightImage] = useState<File | null>(null);
    const [flightImagePreview, setFlightImagePreview] = useState<string | null>(null);
    const [isFlightRecognizing, setIsFlightRecognizing] = useState(false);
    const [pasteHighlight, setPasteHighlight] = useState(false);
    const cardRef = useRef<HTMLDivElement>(null);

    useImperativeHandle(ref, () => ({
      receivePastedImage: (file: File) => {
        handleFlightImageFile(file);
      },
      isActive: () => {
        // 判断当前焦点是否在航班卡片内的可输入元素上
        const active = document.activeElement;
        if (!active || !cardRef.current) return false;
        return cardRef.current.contains(active as Node);
      },
      getRootElement: () => cardRef.current,
    }));

    const update = (field: keyof IFlightInfo, value: string) => {
      onChange({ ...flightInfo, [field]: value });
    };

    /** 航班号变化时自动匹配航司（仅当用户未手动填写航司时才填充） */
    const handleFlightNoChange = (value: string) => {
      const upperValue = value.toUpperCase();
      update('flightNo', upperValue);

      // 航班号长度 < 2 无法匹配
      if (upperValue.length < 2) return;

      // 如果当前航司输入框为空或为默认占位，则自动填充
      if (!flightInfo.airline || flightInfo.airline.startsWith('未知航司')) {
        const { code, name } = extractAirlineCodeFromFlightNo(upperValue);
        if (name) {
          update('airline', name);
        }
      }
    };

    /** 航司输入框失焦时：如果输入的是二字码，自动转换为全称 */
    const handleAirlineBlur = () => {
      const val = flightInfo.airline.trim();
      if (!val) return;
      // 长度 2 或 3，且包含字母 → 可能是二字码/三字码
      if (/^[A-Z0-9]{2,3}$/i.test(val)) {
        const name = getAirlineNameByCode(val);
        if (name) {
          update('airline', name);
          toast.success(`已识别为${name}`);
        } else {
          // 未知二字码，提示用户
          update('airline', `未知航司（${val.toUpperCase()}）`);
          toast.info('未识别到该航司，请手动填写全称');
        }
      }
    };

    const datetimeValue = flightInfo.departureTime
      ? flightInfo.departureTime.slice(0, 16)
      : '';

    const flashHighlight = () => {
      setPasteHighlight(true);
      setTimeout(() => setPasteHighlight(false), 900);
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
            handleFlightImageFile(file);
            return;
          }
        }
        toast.info('剪贴板中没有图片');
      } catch (err) {
        logger.error('读取剪贴板失败:', String(err));
        toast.error('无法读取剪贴板，请使用 Ctrl+V / Cmd+V 粘贴');
      }
    };

    const handleFlightImageFile = (file: File) => {
      onInteract?.();
      if (!file.type.startsWith('image/')) {
        toast.error('请粘贴图片（jpg/png/webp）');
        return;
      }
      if (file.size > 20 * 1024 * 1024) {
        toast.error('图片大小不能超过 20MB');
        return;
      }
      if (flightImagePreview) URL.revokeObjectURL(flightImagePreview);
      setFlightImage(file);
      const url = URL.createObjectURL(file);
      setFlightImagePreview(url);
      flashHighlight();
      // 自动触发识别
      setTimeout(() => recognizeFlightImage(file), 200);
    };

    const clearFlightImage = () => {
      setFlightImage(null);
      if (flightImagePreview) URL.revokeObjectURL(flightImagePreview);
      setFlightImagePreview(null);
    };

    const recognizeFlightImage = async (file: File) => {
      setIsFlightRecognizing(true);
      try {
        const result = await recognizeFlightInfo(file);

        const finalAirline = resolveAirlineName(result.flightNo, result.airlineName);
        const newInfo: IFlightInfo = {
          ...flightInfo,
          airline: finalAirline || flightInfo.airline,
          flightNo: result.flightNo || flightInfo.flightNo,
          cabinCode: result.cabinCode || flightInfo.cabinCode,
          departureTime: result.departureTime || flightInfo.departureTime,
        };

        onChange(newInfo);
        toast.success('航班信息识别完成');
      } catch (err) {
        logger.error('航班信息识别失败:', String(err));
        toast.error(`识别失败：${(err as Error)?.message || '请手动输入航班信息'}`);
      } finally {
        setIsFlightRecognizing(false);
      }
    };

    return (
      <Card ref={cardRef} onClick={onInteract} onFocus={onInteract} className="relative">
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <PlaneTakeoff className="size-4 text-primary" />
            航班信息
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 航班截图粘贴区 - 大尺寸热区 */}
          <div
            className={`
              w-full min-h-[110px] rounded-xl border-2 border-dashed p-4
              flex items-center justify-center
              transition-all duration-200 select-none
              ${pasteHighlight
                ? 'border-primary bg-primary/10'
                : isFlightRecognizing
                    ? 'border-primary/60 bg-primary/5'
                    : 'border-border bg-muted/20 hover:border-primary/40 hover:bg-muted/30'
              }
            `}
          >
            <AnimatePresence mode="wait">
              {flightImagePreview ? (
                <motion.div
                  key="preview"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.25, ease: 'easeOut' }}
                  className="flex items-center gap-4 w-full"
                >
                  <div className="relative shrink-0 w-32 h-20 rounded-lg overflow-hidden border border-border bg-card shadow-sm">
                    <Image
                      src={flightImagePreview}
                      alt="航班截图"
                      className="w-full h-full object-contain"
                    />
                    {isFlightRecognizing && (
                      <div className="absolute inset-0 bg-background/70 flex items-center justify-center">
                        <Loader2 className="size-5 text-primary animate-spin" />
                      </div>
                    )}
                    <Button
                      size="icon"
                      type="button"
                      variant="secondary"
                      onClick={(e) => {
                        e.stopPropagation();
                        clearFlightImage();
                      }}
                      className="!absolute -right-2 -top-2 z-20 h-6 w-6 rounded-full shadow-sm border border-border"
                      aria-label="删除截图"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                      <ClipboardPaste className="size-4 text-primary shrink-0" />
                      航班截图已粘贴
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {isFlightRecognizing
                        ? '正在识别航班号 / 舱位 / 时间...'
                        : '识别完成，下方可手动修改'}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-1.5">
                      再次 Ctrl+V 或拖拽可替换图片
                    </p>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                  className="flex flex-col items-center justify-center gap-2.5 text-center"
                >
                  <div className="size-12 rounded-full bg-primary/10 flex items-center justify-center">
                    {isFlightRecognizing ? (
                      <Loader2 className="size-6 text-primary animate-spin" />
                    ) : (
                      <ClipboardPaste className="size-6 text-primary" />
                    )}
                  </div>
                  <div>
                      <p className="text-sm font-semibold text-foreground">
                        {isFlightRecognizing ? '正在识别航班信息...' : 'Ctrl+V 粘贴航班截图'}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {isFlightRecognizing
                          ? 'AI 正在提取航班号 / 舱位 / 起飞时间'
                          : '在页面任意位置按 Ctrl+V 粘贴航班截图'}
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
                    className="gap-1.5 h-7 px-2.5 text-xs"
                  >
                    <MousePointerClick className="size-3.5" />
                    点击粘贴
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

           <div className="grid grid-cols-2 gap-3">
             <div className="space-y-1.5">
               <Label htmlFor="airline">航空公司</Label>
               <Input
                 id="airline"
                 value={flightInfo.airline}
                 onChange={(e) => update('airline', e.target.value)}
                 onBlur={handleAirlineBlur}
                 placeholder="如：东方航空 / CA"
               />
             </div>
             <div className="space-y-1.5">
               <Label htmlFor="flightNo">航班号</Label>
               <Input
                 id="flightNo"
                 value={flightInfo.flightNo}
                 onChange={(e) => handleFlightNoChange(e.target.value)}
                 placeholder="如：MU5108"
                 className="uppercase"
               />
             </div>
           </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cabinCode">舱位代码</Label>
              <Input
                id="cabinCode"
                value={flightInfo.cabinCode}
                onChange={(e) => update('cabinCode', e.target.value.toUpperCase())}
                placeholder="如：Y / B / M"
                className="uppercase"
                maxLength={2}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="departureTime">计划起飞时间</Label>
              <div className="relative">
                <CalendarDays className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="departureTime"
                  type="datetime-local"
                  value={datetimeValue}
                  onChange={(e) => update('departureTime', e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            起飞时间是所有时间区间计算的基准，请确保准确。
          </p>
        </CardContent>
      </Card>
    );
  },
);

export default FlightInfoForm;
