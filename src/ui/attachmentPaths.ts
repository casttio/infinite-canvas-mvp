export const resolveManagedAttachmentOpenPath = (resolvedPath: string | null | undefined, cachedPath: string | null | undefined) =>
  resolvedPath && resolvedPath.length > 0 ? resolvedPath : cachedPath && cachedPath.length > 0 ? cachedPath : null;
