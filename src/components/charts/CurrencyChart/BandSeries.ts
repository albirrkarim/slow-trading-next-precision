/**
 * Custom series that fills the area between two price rails — used for
 * indicator envelopes (VWAP stdev bands). Follows the lightweight-charts
 * v5 custom-series plugin contract.
 */
import type { CanvasRenderingTarget2D } from "fancy-canvas";
import {
  customSeriesDefaultOptions,
  type CustomData,
  type CustomSeriesOptions,
  type CustomSeriesWhitespaceData,
  type ICustomSeriesPaneRenderer,
  type ICustomSeriesPaneView,
  type PaneRendererCustomData,
  type PriceToCoordinateConverter,
  type Time,
} from "lightweight-charts";

export interface BandPlotRow extends CustomData<Time> {
  lower: number;
  upper: number;
}

export interface BandSeriesOptions extends CustomSeriesOptions {
  fillColor: string;
}

const defaultOptions: BandSeriesOptions = {
  ...customSeriesDefaultOptions,
  fillColor: "rgba(144, 164, 174, 0.18)",
};

class BandSeriesRenderer implements ICustomSeriesPaneRenderer {
  private _data: PaneRendererCustomData<Time, BandPlotRow> | null = null;
  private _options: BandSeriesOptions | null = null;

  update(
    data: PaneRendererCustomData<Time, BandPlotRow>,
    options: BandSeriesOptions,
  ) {
    this._data = data;
    this._options = options;
  }

  draw(
    target: CanvasRenderingTarget2D,
    priceConverter: PriceToCoordinateConverter,
  ) {
    const data = this._data;
    const options = this._options;
    if (!data || !options) return;

    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      const hRatio = scope.horizontalPixelRatio;
      const vRatio = scope.verticalPixelRatio;
      const upperPath: [number, number][] = [];
      const lowerPath: [number, number][] = [];

      for (const bar of data.bars) {
        const upper = bar.originalData.upper;
        const lower = bar.originalData.lower;
        if (!Number.isFinite(upper) || !Number.isFinite(lower)) continue;
        const yUpper = priceConverter(upper);
        const yLower = priceConverter(lower);
        if (yUpper === null || yLower === null) continue;
        const x = bar.x * hRatio;
        upperPath.push([x, yUpper * vRatio]);
        lowerPath.push([x, yLower * vRatio]);
      }

      if (upperPath.length < 2) return;

      ctx.beginPath();
      ctx.moveTo(upperPath[0][0], upperPath[0][1]);
      for (let i = 1; i < upperPath.length; i++) {
        ctx.lineTo(upperPath[i][0], upperPath[i][1]);
      }
      for (let i = lowerPath.length - 1; i >= 0; i--) {
        ctx.lineTo(lowerPath[i][0], lowerPath[i][1]);
      }
      ctx.closePath();
      ctx.fillStyle = options.fillColor;
      ctx.fill();
    });
  }
}

export class BandSeries
  implements ICustomSeriesPaneView<Time, BandPlotRow, BandSeriesOptions>
{
  private readonly _renderer = new BandSeriesRenderer();

  /** Reassigned by the chart when the series attaches. */
  requestUpdate: () => void = () => undefined;

  priceValueBuilder(plotRow: BandPlotRow): number[] {
    return [plotRow.lower, plotRow.upper];
  }

  isWhitespace(
    data: BandPlotRow | CustomSeriesWhitespaceData<Time>,
  ): data is CustomSeriesWhitespaceData<Time> {
    const row = data as BandPlotRow;
    return !Number.isFinite(row.upper) || !Number.isFinite(row.lower);
  }

  renderer(): ICustomSeriesPaneRenderer {
    return this._renderer;
  }

  update(
    data: PaneRendererCustomData<Time, BandPlotRow>,
    options: BandSeriesOptions,
  ) {
    this._renderer.update(data, options);
  }

  defaultOptions(): BandSeriesOptions {
    return defaultOptions;
  }
}
