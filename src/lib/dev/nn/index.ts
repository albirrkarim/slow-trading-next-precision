import dataset from "./dataset";
import logging from "./logging";
import run from "./run";
import research from "./research";
import assessment from "./assessment";
import torch from "./torch";
import torchResearch from "./torch-research";

const nn = { assessment, dataset, logging, research: { ...research, torch: torchResearch.run }, run, torch } as const;
export default nn;
export type * from "./types";
