import "server-only";

const projectPrefix = "ai-website-cloner-template/public";

export function publicUrlToDatabasePath(publicUrl: string) {
  if (!publicUrl.startsWith("/data/") || publicUrl.includes("..")) {
    throw new Error("Invalid public data path.");
  }

  return `${projectPrefix}${publicUrl}`;
}

export function vectorTileSlugToDatabasePath(slug: string[]) {
  if (slug.length === 0 || slug.some((part) => part === ".." || part.includes("\\"))) {
    throw new Error("Invalid vector tile path.");
  }

  return `${projectPrefix}/data/osm-power/tiles/${slug.join("/")}`;
}
