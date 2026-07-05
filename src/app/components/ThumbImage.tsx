import React, { useState } from "react";
import { thumbUrl } from "../lib/thumbUrl";

type ThumbImageProps = React.ImgHTMLAttributes<HTMLImageElement> & {
  src: string;
  thumbWidth?: 300 | 1024;
};

export function ThumbImage({ src, thumbWidth = 300, onError, ...rest }: ThumbImageProps) {
  const [failedThumbSrc, setFailedThumbSrc] = useState<string | null>(null);
  const thumb = thumbUrl(src, thumbWidth);
  const resolved = failedThumbSrc === src ? src : thumb;
  return (
    <img
      src={resolved}
      loading="lazy"
      decoding="async"
      {...rest}
      onError={(event) => {
        if (resolved !== src) {
          setFailedThumbSrc(src);
          return;
        }
        onError?.(event);
      }}
    />
  );
}
