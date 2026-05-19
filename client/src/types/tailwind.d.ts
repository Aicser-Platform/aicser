
declare module 'react' {
  interface HTMLAttributes<T> {
    className?: string;
  }
}

// Extend JSX namespace to accept className prop
declare global {
  namespace JSX {
    interface IntrinsicElements {
      [elemName: string]: any;
    }
  }
}

export {};