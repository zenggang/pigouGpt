"use client";

import Image from "next/image";

type BrandMarkProps = {
  size?: "sm" | "md" | "lg";
  className?: string;
};

const sizeClassName = {
  sm: "h-8 w-8",
  md: "h-10 w-10",
  lg: "h-14 w-14",
};

const imageSize = {
  sm: 32,
  md: 40,
  lg: 56,
};

export function BrandMark({ size = "md", className = "" }: BrandMarkProps) {
  const pixels = imageSize[size];

  return (
    <div
      className={`${sizeClassName[size]} shrink-0 overflow-hidden rounded-xl border border-pink-100 bg-white shadow-sm ${className}`}
    >
      <Image
        src="/brand-puppy.png"
        alt="Pigou AI Console 小狗标识"
        width={pixels}
        height={pixels}
        priority={size === "lg"}
        className="h-full w-full object-cover"
      />
    </div>
  );
}
