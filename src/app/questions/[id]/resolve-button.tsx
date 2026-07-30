"use client";

import { Button } from "@/components/ui/button";
import { resolveQuestionAction } from "@/app/questions/actions";
import { CheckCircle2, RotateCcw } from "lucide-react";

interface ResolveButtonProps {
  questionId: string;
  resolved: boolean;
}

export function ResolveButton({ questionId, resolved }: ResolveButtonProps) {
  return (
    <form
      action={async () => {
        await resolveQuestionAction({
          id: questionId,
          resolved: !resolved,
        });
      }}
    >
      <Button type="submit" variant="outline" size="sm">
        {resolved ? (
          <>
            <RotateCcw className="h-4 w-4" />
            Reabrir
          </>
        ) : (
          <>
            <CheckCircle2 className="h-4 w-4" />
            Marcar como resuelta
          </>
        )}
      </Button>
    </form>
  );
}
