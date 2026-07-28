"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface FollowButtonProps {
  isFollowing?: boolean;
  onToggle?: () => void;
  className?: string;
  disabled?: boolean;
}

export function FollowButton({ isFollowing = false, onToggle, className, disabled }: FollowButtonProps) {
  return (
    <Button
      variant={isFollowing ? "outline" : "default"}
      size="sm"
      className={cn("rounded-full text-xs font-bold", className)}
      onClick={onToggle}
      disabled={disabled}
    >
      {isFollowing ? "Siguiendo" : "Seguir"}
    </Button>
  );
}
