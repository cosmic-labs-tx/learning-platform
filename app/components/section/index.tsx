import { Link } from "@remix-run/react";

import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

interface SectionHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  sectionTitle: string;
  durationInMinutes: number;
}

export function SectionHeader(props: SectionHeaderProps) {
  const { sectionTitle, durationInMinutes, className, ...rest } = props;
  return (
    <header {...rest} className={cn("space-y-1", className)}>
      <h2 className="text-2xl">{sectionTitle}</h2>
      <p className="text-sm font-light">{durationInMinutes} min</p>
    </header>
  );
}

export function Section(props: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <section
      {...props}
      className={cn("rounded-xl p-6 pb-8 shadow-[0px_8px_32px_0px_rgba(0,0,0,0.08)] dark:border", props.className)}
    ></section>
  );
}

export function SectionItemButton({ children, to }: { children: React.ReactNode; to: string }) {
  return (
    <Button variant="secondary" className="ml-auto" asChild>
      <Link to={to}>{children}</Link>
    </Button>
  );
}

export function SectionItemTitle({ children, className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 {...props} className={cn("text-lg font-medium", className)}>
      {children}
    </h3>
  );
}

export function SectionItemIconContainer({ children, className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...props} className={cn("flex basis-7 justify-start", className)}>
      {children}
    </div>
  );
}

export function SectionItemDescription({ children, className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p {...props} className={cn("text-sm font-light leading-4", className)}>
      {children}
    </p>
  );
}

export function SectionItemContainer({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...props} className={cn("flex items-center gap-2", props.className)}>
      {children}
    </div>
  );
}
