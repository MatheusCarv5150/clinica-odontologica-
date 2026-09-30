import React from "react"
import { cn } from "@/lib/utils"

interface LogoIconProps extends React.SVGProps<SVGSVGElement> {
  className?: string
  size?: number
}

export function LogoIcon({ className, size = 24, ...props }: LogoIconProps) {
  return (
    <svg
      className={cn("text-white", className)}
      width={size}
      height={size}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      {...props}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z"
      />
    </svg>
  )
}

interface LogoFullProps {
  className?: string
  size?: "sm" | "md" | "lg" | "xl"
  iconSize?: number
  showSubtitle?: boolean
  variant?: "light" | "dark"
}

export function LogoFull({
  className,
  size = "md",
  iconSize,
  showSubtitle = true,
  variant = "light",
}: LogoFullProps) {
  const iconDim =
    iconSize ||
    (size === "sm" ? 28 : size === "lg" ? 40 : size === "xl" ? 48 : 36)

  const containerClasses = cn(
    "flex items-center gap-3 select-none",
    size === "sm" && "gap-2.5",
    className
  )

  const iconBoxClasses = cn(
    "flex items-center justify-center rounded-xl bg-blue-600 shadow-md shadow-blue-600/20 text-white shrink-0 transition-transform hover:scale-105",
    size === "sm" && "h-9 w-9 rounded-lg",
    size === "md" && "h-11 w-11 rounded-xl",
    size === "lg" && "h-14 w-14 rounded-2xl",
    size === "xl" && "h-16 w-16 rounded-2xl"
  )

  const titleClasses = cn(
    "font-bold tracking-tight leading-none",
    size === "sm" && "text-sm",
    size === "md" && "text-base",
    size === "lg" && "text-xl",
    size === "xl" && "text-2xl",
    variant === "dark" ? "text-white" : "text-gray-900"
  )

  const subtitleClasses = cn(
    "font-medium leading-tight mt-1",
    size === "sm" && "text-[10px]",
    size === "md" && "text-[11px]",
    size === "lg" && "text-xs",
    size === "xl" && "text-sm",
    variant === "dark" ? "text-blue-200" : "text-gray-500"
  )

  return (
    <div className={containerClasses}>
      <div className={iconBoxClasses}>
        <LogoIcon size={iconDim} />
      </div>
      <div className="flex flex-col">
        <span className={titleClasses}>OdontoCare</span>
        {showSubtitle && <span className={subtitleClasses}>Sistema de Gestão Odontológica</span>}
      </div>
    </div>
  )
}
