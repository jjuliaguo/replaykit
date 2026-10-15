import { useEffect, useState } from "react";

/** True at Tailwind's md breakpoint (768px) and up. */
export function useIsDesktop(): boolean {
  const query = "(min-width: 768px)";
  const [match, setMatch] = useState(() => typeof window === "undefined" || window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return match;
}
