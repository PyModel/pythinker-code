import { useState, useEffect, useRef } from "react";
import { useChatStore } from "@/stores";
import { cn } from "@/lib/utils";

const focusComposer = () => document.querySelector<HTMLTextAreaElement>("textarea")?.focus();

export function QuestionDialog() {
  const { pendingQuestion, respondQuestion } = useChatStore();
  const [customInput, setCustomInput] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(1);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const cardRef = useRef<HTMLDivElement>(null);
  // The question stays pending until the RPC settles, so repeated key presses
  // would submit duplicate answers without this guard.
  const inFlightRef = useRef(false);
  const [multiSelected, setMultiSelected] = useState<string[]>([]);

  const questions = pendingQuestion?.questions ?? [];
  const question = questions[questionIndex];
  const isMultiSelect = question?.multi_select === true;
  const isLastQuestion = questionIndex + 1 >= questions.length;

  useEffect(() => {
    if (pendingQuestion) {
      setShowCustom(false);
      setCustomInput("");
      setSelectedIndex(1);
      setQuestionIndex(0);
      setAnswers({});
      cardRef.current?.focus();
      setMultiSelected([]);
    }
  }, [pendingQuestion?.id]);

  if (!pendingQuestion || !question) return null;

  // Step through the questions one by one; submit all answers after the last.
  const handleAnswer = async (answer: string) => {
    const nextAnswers = { ...answers, [question.question]: answer };
    if (!isLastQuestion) {
      setAnswers(nextAnswers);
      setQuestionIndex(questionIndex + 1);
      setShowCustom(false);
      setCustomInput("");
      setSelectedIndex(1);
      setMultiSelected([]);
    } else {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        await respondQuestion(nextAnswers);
        focusComposer();
      } finally {
        inFlightRef.current = false;
      }
    }
  };

  const handleSelect = async (optionLabel: string) => {
    if (isMultiSelect) {
      setMultiSelected((prev) =>
        prev.includes(optionLabel) ? prev.filter((value) => value !== optionLabel) : [...prev, optionLabel],
      );
      return;
    }
    await handleAnswer(optionLabel);
  };

  const handleCustomSubmit = async () => {
    const value = customInput.trim();
    if (!value) return;
    if (isMultiSelect) {
      setMultiSelected((prev) => (prev.includes(value) ? prev : [...prev, value]));
      setCustomInput("");
      setShowCustom(false);
      return;
    }
    await handleAnswer(value);
  };

  const options = question.options || [];
  const customIndex = options.length + 1;
  const customValues = multiSelected.filter((value) => !options.some((option) => option.label === value));

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (showCustom) return; // the custom input owns the keyboard while open
    const digit = Number(e.key);
    if (digit >= 1 && digit <= customIndex) {
      e.preventDefault();
      if (digit === customIndex) {
        setShowCustom(true);
      } else {
        const opt = options[digit - 1];
        if (opt) void handleSelect(opt.label);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, customIndex));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (selectedIndex === customIndex) {
        setShowCustom(true);
      } else {
        const opt = options[selectedIndex - 1];
        if (opt) void handleSelect(opt.label);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      focusComposer();
    }
  };

  return (
    <div
      ref={cardRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className={cn("mb-0.5 border border-brand/40 rounded-lg overflow-hidden bg-background flex flex-col shrink", "outline-none focus:ring-1 focus:ring-ring")}
    >
      <div className="p-2 space-y-2">
        {questions.length > 1 && (
          <div className="text-[10px] text-muted-foreground">
            Question {questionIndex + 1} of {questions.length}
          </div>
        )}
        {question.header && <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{question.header}</div>}
        <div className="text-xs font-semibold text-foreground">{question.question}</div>
        {isMultiSelect && <div className="text-[10px] text-muted-foreground">Select all that apply</div>}
        <div className="space-y-1.5">
          {options.map((option, idx) => {
            const isChecked = isMultiSelect && multiSelected.includes(option.label);
            const isHighlighted = selectedIndex === idx + 1;
            return (
              <button
                key={idx}
                onClick={() => {
                  void handleSelect(option.label);
                }}
                onMouseEnter={() => setSelectedIndex(idx + 1)}
                className={cn(
                  "w-full text-left px-2 py-1 rounded-md text-xs transition-colors",
                  "border cursor-pointer",
                  isChecked
                    ? "bg-blue-500/15 border-blue-500"
                    : isHighlighted
                      ? "bg-blue-500 text-white border-blue-500"
                      : "bg-background border-border hover:bg-muted/50",
                )}
              >
                <span className={cn("mr-2", isHighlighted && !isChecked ? "text-blue-200" : "text-muted-foreground")}>
                  {isChecked ? "✓" : idx + 1}
                </span>
                <span className="font-medium">{option.label}</span>
                {option.description && (
                  <span className={cn("ml-2", isHighlighted && !isChecked ? "text-blue-200" : "text-muted-foreground")}>- {option.description}</span>
                )}
              </button>
            );
          })}
          {customValues.map((value) => (
            <button
              key={value}
              onClick={() => {
                void handleSelect(value);
              }}
              className={cn(
                "w-full text-left px-2 py-1 rounded-md text-xs transition-colors",
                "border cursor-pointer bg-blue-500/15 border-blue-500",
              )}
            >
              <span className="mr-2 text-muted-foreground">✓</span>
              <span className="font-medium">{value}</span>
            </button>
          ))}
          {showCustom ? (
            <div className="flex gap-1.5">
              <input
                autoFocus
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleCustomSubmit();
                  if (e.key === "Escape") {
                    setShowCustom(false);
                    cardRef.current?.focus();
                  }
                }}
                placeholder="Enter your response..."
                className="flex-1 px-2 py-1 rounded-md text-xs border border-border bg-background outline-none focus:border-ring"
              />
              <button
                onClick={() => {
                  void handleCustomSubmit();
                }}
                disabled={!customInput.trim()}
                className="px-2 py-1 rounded-md text-xs bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 cursor-pointer"
              >
                Send
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowCustom(true)}
              onMouseEnter={() => setSelectedIndex(customIndex)}
              className={cn(
                "w-full text-left px-2 py-1 rounded-md text-xs transition-colors",
                "border border-border cursor-pointer",
                selectedIndex === customIndex ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted/50",
              )}
            >
              <span className={cn("mr-2", selectedIndex === customIndex ? "text-primary-foreground/70" : "text-muted-foreground")}>{customIndex}</span>
              <span className="font-medium">Custom response...</span>
            </button>
          )}
          {isMultiSelect && (
            <button
              onClick={() => {
                void handleAnswer(multiSelected.join(", "));
              }}
              disabled={multiSelected.length === 0}
              className="w-full px-2 py-1 rounded-md text-xs bg-blue-500 text-white disabled:opacity-50 cursor-pointer"
            >
              {isLastQuestion ? "Submit" : "Next"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
