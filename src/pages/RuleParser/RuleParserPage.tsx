import { useState, useRef, useEffect } from 'react';
import { TicketCheck, AlertTriangle, Image as ImageIcon, PlaneTakeoff, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import InputPanel, {
  type InputPanelHandle,
  type RecognizeMode,
} from './InputPanel';
import FlightInfoForm, { type FlightInfoFormHandle } from './FlightInfoForm';
import ParsedRuleEditor from './ParsedRuleEditor';
import OutputPanel from './OutputPanel';
import { MOCK_FLIGHT_INFO, type IFlightInfo } from '@/data/flight-info';
import { MOCK_PARSED_RULE_EMPTY, type IParsedRule } from '@/data/parsed-rule';
import { parseAiResultToRule } from '@/lib/parse-ai-result';
import { applyTransferInheritance, buildOutputText, hasValidOutput, validateCabinRows } from '@/lib/rule-utils';
import { toast } from 'sonner';
import { logger } from '@lark-apaas/client-toolkit-lite';

export default function RuleParserPage() {
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [textContent, setTextContent] = useState('');
  const [isRecognizing, setIsRecognizing] = useState(false);
  const [recognizeProgress, setRecognizeProgress] = useState('');
  const [recognizeMode, setRecognizeMode] = useState<RecognizeMode>('focus');
  const [focusTargetCabin, setFocusTargetCabin] = useState('');
  const [notFoundCabin, setNotFoundCabin] = useState<string | null>(null);
  const [aiRawText, setAiRawText] = useState('');
  const [matchDebugInfo, setMatchDebugInfo] = useState('');

  const [flightInfo, setFlightInfo] = useState<IFlightInfo>(MOCK_FLIGHT_INFO);
  const [parsedRule, setParsedRule] = useState<IParsedRule>(MOCK_PARSED_RULE_EMPTY);

  const inputPanelRef = useRef<InputPanelHandle>(null);
  const flightFormRef = useRef<FlightInfoFormHandle>(null);

  // 最近交互的区域，用于粘贴图片时智能分发
  const [lastInteractedZone, setLastInteractedZone] = useState<'flight' | 'ticket' | null>(null);
  const [pasteChooserOpen, setPasteChooserOpen] = useState(false);
  const pendingPasteFileRef = useRef<File | null>(null);
  const [showPasteTip, setShowPasteTip] = useState(true);

  const handleRecognizeStart = (mode: RecognizeMode, targetCabin: string) => {
    setIsRecognizing(true);
    setRecognizeProgress('');
    setRecognizeMode(mode);
    setFocusTargetCabin(targetCabin);
    setNotFoundCabin(null);
    setAiRawText('');
    setMatchDebugInfo('');
  };

  const handleRecognizeChunk = (chunk: string) => {
    setRecognizeProgress((prev) => prev + chunk);
  };

  const handleRecognizeComplete = (
    rawText: string,
    success: boolean,
    mode: RecognizeMode,
    targetCabin: string,
  ) => {
    setIsRecognizing(false);
    if (!success || !rawText) return;

    setAiRawText(rawText);

    const parsed = parseAiResultToRule(rawText);
    // transferAllowed 只有当 AI 明确识别到（true/false）时才覆盖，否则保持 'unknown'
    const mergedTransfer =
      typeof parsed.transferAllowed === 'boolean' ? parsed.transferAllowed : 'unknown';
    const merged: IParsedRule = {
      ...MOCK_PARSED_RULE_EMPTY,
      ...parsed,
      id: 'parsed-' + Date.now(),
      airline: parsed.airline || flightInfo.airline,
      changeIntervals: parsed.changeIntervals ?? [],
      refundIntervals: parsed.refundIntervals ?? [],
      cabinRows: validateCabinRows(
        applyTransferInheritance(parsed.cabinRows ?? []),
        targetCabin || undefined,
      ),
      transferAllowed: mergedTransfer,
    };

    // 生成匹配调试信息
    const cabinList = merged.cabinRows.map((r) => r.cabinCode).join(', ');
    const target = targetCabin || (mode === 'focus' ? focusTargetCabin : '');
    const debugLines = [
      `识别模式: ${mode === 'focus' ? '单舱位聚焦' : '全量识别'}`,
      `目标舱位: ${target || '(未指)'}`,
      `AI 返回舱位数量: ${merged.cabinRows.length}`,
      `AI 返回舱位列表: [${cabinList || '空'}]`,
    ];

    // 逐行展示识别结果，方便核对是否串行/漏行
    if (merged.cabinRows.length > 0) {
      debugLines.push('', '—— 逐行识别明细 ——');
      merged.cabinRows.forEach((r, idx) => {
        const refund = r.refundRates.join('/') || '(空)';
        const change = r.changeRates.join('/') || '(空)';
        const discount = r.discount ? `折扣=${r.discount}` : '折扣=未识别';
        let transfer = '';
        if (r.transferAllowed === true) transfer = '签转=允许';
        else if (r.transferAllowed === false) transfer = '签转=不允许';
        else if (r.transferAllowed === 'unknown') transfer = '签转=未识别';
        else if (r.transferAllowed === 'inherit') transfer = '签转=继承';
        const inherited = r.transferInheritedFrom ? `(自${r.transferInheritedFrom}舱)` : '';
        const warning = r.rowWarning ? ` ⚠${r.rowWarning}` : '';
        debugLines.push(
          `第${idx + 1}行 ${r.cabinCode}舱 [${discount}] 退票=${refund} 变更=${change} ${transfer}${inherited}${warning}`,
        );
      });
    }

    if (target) {
      const found = merged.cabinRows.some(
        (r) => r.cabinCode.toUpperCase() === target.toUpperCase(),
      );
      debugLines.push('', `匹配结果: ${found ? '✓ 找到目标舱位' : '✗ 未找到目标舱位'}`);
      if (!found && merged.cabinRows.length > 0) {
        debugLines.push('可能原因: AI 未识别到该舱位行，或舱位代码格式不匹配');
      }
    }
    setMatchDebugInfo(debugLines.join('\n'));

    // 聚焦模式：检查目标舱位是否被识别到
    if (mode === 'focus' && targetCabin) {
      const found = merged.cabinRows.some(
        (r) => r.cabinCode.toUpperCase() === targetCabin.toUpperCase(),
      );
      if (!found) {
        setNotFoundCabin(targetCabin);
        // 即使没找到也展示结果（可能只有时间区间等信息），并提示用户
        toast.warning(
          `未在表格中找到 ${targetCabin} 舱，请确认舱位代码或切换为全量识别`,
        );
      } else {
        setNotFoundCabin(null);
      }
    }

    setParsedRule(merged);

    // ===== 识别结果完整性校验 =====
    const missingParts: string[] = [];
    const changeLen = merged.changeIntervals.length;
    const refundLen = merged.refundIntervals.length;
    const cabinLen = merged.cabinRows.length;
    const hasAnyRate = merged.cabinRows.some(
      (r) => r.changeRates.some(Boolean) || r.refundRates.some(Boolean),
    );

    if (changeLen === 0) missingParts.push('变更时间区间');
    if (refundLen === 0) missingParts.push('退票时间区间');
    if (cabinLen === 0) {
      missingParts.push('舱位行');
    } else if (!hasAnyRate) {
      missingParts.push('舱位费率数据');
    }

    if (missingParts.length > 0) {
      toast.warning(
        `识别结果不完整，缺失：${missingParts.join('、')}。可使用「手动录入」或表格编辑补齐。`,
        { duration: 5000 },
      );
    }

    if (parsed.airline && !flightInfo.airline) {
      setFlightInfo((prev) => ({ ...prev, airline: parsed.airline! }));
    }
  };

  // 首次进入提示条，3 秒后自动消失
  useEffect(() => {
    const timer = setTimeout(() => setShowPasteTip(false), 3500);
    return () => clearTimeout(timer);
  }, []);

  // ===== 全局 paste 事件：智能分发到航班区或票规区 =====
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items || items.length === 0) return;

      let imageFile: File | null = null;
      let hasText = false;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
          imageFile = item.getAsFile();
          // 找到图片也要继续检查是否有文本（用于判断类型）
        } else if (item.type === 'text/plain') {
          hasText = true;
        }
      }

      // 只有图片，没有文本 → 拦截默认行为，走航班/票规识别流程
      // （有文本时不拦截，让输入框正常粘贴文字）
      if (!imageFile) return;
      if (hasText) {
        // 剪贴板同时含图片和文字的情况也拦截图片路径，避免误粘贴到输入框
        // 但让文字部分保留给可能的文本框 — 实际上 imageFile 优先走识别
      }
      e.preventDefault();
      e.stopPropagation();

      const flightEl = flightFormRef.current?.getRootElement();
      const ticketEl = inputPanelRef.current?.getRootElement();
      const active = document.activeElement;

      let target: 'flight' | 'ticket' | null = null;

      // 策略 1：焦点在输入框内，且输入框属于某个卡片 → 归属该卡片
      if (active && flightEl && flightEl.contains(active as Node)) {
        target = 'flight';
      } else if (active && ticketEl && ticketEl.contains(active as Node)) {
        target = 'ticket';
      }
      // 策略 2：最近交互过的区域（点击过、上传过等）
      if (!target && lastInteractedZone) {
        target = lastInteractedZone;
      }
      // 策略 3：根据元素在视口中的位置（哪个卡片的中心离视口中心更近）
      if (!target && flightEl && ticketEl) {
        const flightRect = flightEl.getBoundingClientRect();
        const ticketRect = ticketEl.getBoundingClientRect();
        const viewportCenter = window.innerHeight / 2;
        const flightCenter = flightRect.top + flightRect.height / 2;
        const ticketCenter = ticketRect.top + ticketRect.height / 2;
        // 只考虑在视口内（top < innerHeight && bottom > 0）的卡片
        const flightVisible = flightRect.top < window.innerHeight && flightRect.bottom > 0;
        const ticketVisible = ticketRect.top < window.innerHeight && ticketRect.bottom > 0;

        if (flightVisible && !ticketVisible) {
          target = 'flight';
        } else if (ticketVisible && !flightVisible) {
          target = 'ticket';
        } else if (flightVisible && ticketVisible) {
          const flightDist = Math.abs(flightCenter - viewportCenter);
          const ticketDist = Math.abs(ticketCenter - viewportCenter);
          target = flightDist < ticketDist ? 'flight' : 'ticket';
        }
      }

      // 还是无法判断 → 弹选择对话框
      if (!target) {
        pendingPasteFileRef.current = imageFile;
        setPasteChooserOpen(true);
        return;
      }

      try {
        // 记录最近交互区域
        setLastInteractedZone(target);
        if (target === 'flight' && flightFormRef.current) {
          flightFormRef.current.receivePastedImage(imageFile);
        } else if (target === 'ticket' && inputPanelRef.current) {
          inputPanelRef.current.receivePastedImage(imageFile);
        }
      } catch (err) {
        logger.error('粘贴图片处理失败:', String(err));
        toast.error('粘贴失败，请重试');
      }
    };

    window.addEventListener('paste', onPaste, true);
    document.addEventListener('paste', onPaste, true);
    return () => {
      window.removeEventListener('paste', onPaste, true);
      document.removeEventListener('paste', onPaste, true);
    };
  }, [lastInteractedZone]);

  const targetCabin = flightInfo.cabinCode.trim().toUpperCase();

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-secondary/10">
      {/* 顶部粘贴提示条 */}
      <AnimatePresence>
        {showPasteTip && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="fixed top-0 left-0 right-0 z-[90] bg-primary text-primary-foreground py-2 px-4"
          >
            <div className="max-w-[1400px] mx-auto flex items-center justify-center gap-2 text-sm">
              <Info className="size-4 shrink-0" />
              <span>提示：在页面任意位置按 Ctrl+V / Cmd+V 即可粘贴图片，自动识别航班或票规信息</span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setShowPasteTip(false)}
                className="h-6 px-2 text-xs text-primary-foreground/90 hover:text-primary-foreground hover:bg-primary-foreground/20 shrink-0 ml-2"
              >
                知道了
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 顶部标题栏 */}
      <header className={`sticky z-40 w-full transition-all duration-300 ${showPasteTip ? 'top-9' : 'top-0'} bg-background/80 backdrop-blur-md border-b border-border/40`}>
        <div className="max-w-[1400px] mx-auto px-4 md:px-6 flex h-14 items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="size-8 rounded-md bg-primary text-primary-foreground flex items-center justify-center">
              <TicketCheck className="size-4.5" />
            </div>
            <div>
              <div className="text-sm font-semibold leading-tight">通用航司票规识别工具</div>
              <div className="text-[11px] text-muted-foreground leading-tight">
                支持任意航司 · 自动识别舱位费率表 · 一键生成格式化规则
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* 主内容 */}
      <main className="max-w-[1400px] mx-auto px-4 md:px-6 py-6">
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* 左侧：输入 + 表格（占 2 列） */}
          <div className="xl:col-span-2 space-y-6 order-2 xl:order-1">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* 左：航班信息 */}
              <FlightInfoForm
                ref={flightFormRef}
                flightInfo={flightInfo}
                onChange={setFlightInfo}
                onInteract={() => setLastInteractedZone('flight')}
              />
              {/* 右：票规输入 */}
              <InputPanel
                ref={inputPanelRef}
                onRecognizeStart={handleRecognizeStart}
                onRecognizeChunk={handleRecognizeChunk}
                onRecognizeComplete={handleRecognizeComplete}
                imageFile={imageFile}
                setImageFile={setImageFile}
                imagePreview={imagePreview}
                setImagePreview={setImagePreview}
                textContent={textContent}
                setTextContent={setTextContent}
                isRecognizing={isRecognizing}
                targetCabinCode={targetCabin}
                recognizeMode={recognizeMode}
                onRecognizeModeChange={setRecognizeMode}
                onInteract={() => setLastInteractedZone('ticket')}
              />
            </div>

            {/* 未找到目标舱位警告 */}
            {notFoundCabin && (
              <div className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3">
                <AlertTriangle className="size-5 text-warning shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="text-sm font-medium text-warning-foreground">
                    未在表格中找到 {notFoundCabin} 舱
                  </div>
                  <div className="text-xs text-warning-foreground/80 mt-0.5">
                    请确认舱位代码是否正确，或切换为「识别全部舱位」模式重新识别。
                  </div>
                </div>
              </div>
            )}

            <ParsedRuleEditor
              parsedRule={parsedRule}
              onChange={setParsedRule}
              targetCabin={targetCabin}
              aiRawText={aiRawText}
              matchDebugInfo={matchDebugInfo}
            />
          </div>

          {/* 右侧：输出面板（占 1 列） */}
          <div className="xl:col-span-1 order-1 xl:order-2 xl:sticky xl:top-20 xl:self-start">
            <OutputPanel
              parsedRule={parsedRule}
              flightInfo={flightInfo}
              isRecognizing={isRecognizing}
              recognizeProgress={recognizeProgress}
            />
          </div>
        </div>

        <footer className="mt-12 pb-6 text-center text-xs text-muted-foreground">
          票规解析结果仅供参考，请以航空公司官方规则为准。
        </footer>
      </main>

      {/* 粘贴目标选择对话框 */}
      <Dialog open={pasteChooserOpen} onOpenChange={setPasteChooserOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>粘贴图片识别为？</DialogTitle>
            <DialogDescription>
              检测到剪贴板中有图片，请选择识别目标。
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <Button
              type="button"
              variant="outline"
              className="h-auto flex-col gap-2 py-4 hover:border-primary hover:bg-primary/5"
              onClick={() => {
                const f = pendingPasteFileRef.current;
                setPasteChooserOpen(false);
                pendingPasteFileRef.current = null;
                if (f) {
                  setLastInteractedZone('flight');
                  flightFormRef.current?.receivePastedImage(f);
                }
              }}
            >
              <PlaneTakeoff className="size-5 text-primary" />
              <span className="text-sm font-medium">航班信息截图</span>
              <span className="text-[11px] text-muted-foreground font-normal">
                识别航班号 / 舱位 / 时间
              </span>
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-auto flex-col gap-2 py-4 hover:border-primary hover:bg-primary/5"
              onClick={() => {
                const f = pendingPasteFileRef.current;
                setPasteChooserOpen(false);
                pendingPasteFileRef.current = null;
                if (f) {
                  setLastInteractedZone('ticket');
                  inputPanelRef.current?.receivePastedImage(f);
                }
              }}
            >
              <ImageIcon className="size-5 text-primary" />
              <span className="text-sm font-medium">票规表格图片</span>
              <span className="text-[11px] text-muted-foreground font-normal">
                识别舱位费率 / 退改规则
              </span>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
