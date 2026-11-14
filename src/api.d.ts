import type { PreviewDataV07, PreviewDataSource, PreviewDataWorkStore, BuildSiteResult, BuildOptions } from '@zeropress/build-core';
export interface RunBuildOptions extends Pick<BuildOptions, 'generateFeed' | 'generateSearchIndex' | 'maxBodyBytes' | 'allowDataUriImages' | 'reportDataUriImages'> {
  publicDir?: string;
  emptyOutDir?: boolean;
  projectRoot?: string;
  previewDataPath?: string;
}
export function runBuild(themeDir: string, previewData: PreviewDataV07, outDir: string, options?: RunBuildOptions): Promise<BuildSiteResult>;
export function runBuildFromSource(themeDir: string, source: PreviewDataSource, outDir: string, options?: RunBuildOptions & { workStore?: PreviewDataWorkStore }): Promise<BuildSiteResult>;
export { openPreviewDataSource, readPreviewDataHeader } from '@zeropress/build-core/node';
