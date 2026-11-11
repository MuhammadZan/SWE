import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { slugify } from "@/lib/slug";
import { Mermaid } from "./Mermaid";

function textOf(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node && typeof node === "object" && "props" in node)
    return textOf((node as { props: { children?: React.ReactNode } }).props.children);
  return "";
}

export function Markdown({ children, className = "" }: { children: string; className?: string }) {
  return (
    <div className={`prose ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h2: ({ children }) => <h2 id={slugify(textOf(children))}>{children}</h2>,
          h3: ({ children }) => <h3 id={slugify(textOf(children))}>{children}</h3>,
          // ```mermaid fences render as diagrams; everything else stays a code block.
          pre: ({ children, node }) => {
            const code = node?.children[0];
            const classes = code && "properties" in code ? code.properties?.className : undefined;
            if (Array.isArray(classes) && classes.includes("language-mermaid"))
              return <Mermaid chart={textOf(children).replace(/\n$/, "")} />;
            return <pre>{children}</pre>;
          },
          a: ({ href, children }) => {
            const external = href?.startsWith("http");
            return (
              <a href={href} {...(external ? { target: "_blank", rel: "noreferrer" } : {})}>
                {children}
              </a>
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
