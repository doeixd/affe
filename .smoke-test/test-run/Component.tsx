import { createComponent } from "@doeixd/affe/runtime";

export function SmokeComponent({ count }) {
  return (
    <div>Count: {count()}</div>
  );
}
