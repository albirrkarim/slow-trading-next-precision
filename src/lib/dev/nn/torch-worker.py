"""CPU-only training worker. Receives training rows; never reads a test cache."""
import os
os.environ.setdefault("OMP_NUM_THREADS", "4")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "4")
import copy
import json
import sys
import time

import numpy as np
import torch
from torch import nn
from torch.nn import functional as F


def train(source):
    """Fit each seed on purged rows and select checkpoints on training validation."""
    torch.set_num_threads(4)
    torch.use_deterministic_algorithms(True)
    options = source["options"]
    raw = np.array(source["raw"], dtype=float)
    scores = np.array(source["scores"])
    eligible = np.array(source.get("eligible", [True] * len(scores)), dtype=bool)
    ordinal = options.get("objective") == "ordinal"
    targets = [1, 2, 3] if ordinal else [options["learningTarget"]]
    head = 2 if ordinal else 0
    labels = torch.tensor(np.stack([scores >= target for target in targets], axis=1).astype(float), dtype=torch.float32)
    loss_weights = torch.tensor([0.5, 0.5, 1.0] if ordinal else [1.0])
    results = []
    print(f"TORCH version={torch.__version__} numpy={np.__version__} device=cpu objective={'ordinal' if ordinal else 'binary'} targets={targets} exportedHead=score>={targets[head]}", flush=True)
    for fold in source["folds"]:
        normalization = fold["normalization"]
        scaled = np.nan_to_num(np.clip((raw - normalization["mean"]) / normalization["std"], -normalization["clip"], normalization["clip"]))
        x = torch.tensor(np.concatenate([scaled, np.isfinite(raw).astype(float)], axis=1), dtype=torch.float32)
        fit = np.array(fold["fit"])
        calibration = np.array(fold["calibration"])
        validation = np.isin(calibration, fold["validation"])
        holdout = np.array(fold["holdout"])
        positives = np.array([sum(scores[fit] >= target) for target in targets])
        if np.any(positives == 0) or np.any(positives == len(fit)):
            raise ValueError("Fitting rows need both learning classes")
        weight = torch.tensor((len(fit) - positives) / positives, dtype=torch.float32)
        members = []
        print(f"FIT hold={fold['symbol']} fit={len(fit)} validation={sum(validation)} calibration={len(calibration)}", flush=True)
        for seed in options["seeds"]:
            torch.manual_seed(seed)
            layers = []
            previous = x.shape[1]
            for width in options["hidden"]:
                layers.extend([nn.Linear(previous, width), nn.ReLU() if options["activation"] == "relu" else nn.Tanh()])
                if options["dropout"]:
                    layers.append(nn.Dropout(options["dropout"]))
                previous = width
            layers.append(nn.Linear(previous, len(targets)))
            model = nn.Sequential(*layers)
            optimizer = torch.optim.Adam(model.parameters(), lr=options["learningRate"], weight_decay=options["l2"])
            best = None
            stale = 0
            started = time.monotonic()
            for epoch in range(1, options["epochs"] + 1):
                model.train()
                order = np.random.default_rng(seed + epoch).permutation(fit)
                loss_sum = 0
                for start in range(0, len(order), options["batchSize"]):
                    indices = order[start:start + options["batchSize"]]
                    optimizer.zero_grad()
                    losses = F.binary_cross_entropy_with_logits(model(x[indices]), labels[indices], pos_weight=weight, reduction="none")
                    loss = (losses * loss_weights).mean()
                    loss.backward()
                    optimizer.step()
                    loss_sum += float(loss.detach()) * len(indices)
                model.eval()
                with torch.no_grad():
                    risk = torch.sigmoid(model(x[calibration]))[:, head].numpy()
                unsafe = (scores[calibration] >= 3) & eligible[calibration]
                cutoff = float(min(risk[unsafe])) if np.any(unsafe) else 1.0
                passes = (risk < cutoff) & eligible[calibration]
                accepted = passes & validation
                count = int(sum(accepted))
                average = float(np.mean(scores[calibration][accepted])) if count else None
                worst = int(max(scores[calibration][accepted])) if count else None
                rank = (count, -average if average is not None else -1e10, int(sum(passes)))
                improved = best is None or rank > best[0]
                if improved:
                    best = (rank, epoch, copy.deepcopy(model.state_dict()))
                    stale = 0
                else:
                    stale += 1
                if epoch == 1 or epoch % options["logEvery"] == 0 or improved:
                    eta = (time.monotonic() - started) / epoch * (options["epochs"] - epoch)
                    print(f"EPOCH hold={fold['symbol']} seed={seed} {epoch}/{options['epochs']} loss={loss_sum/len(fit):.5f} valAccepted={count} mean={average} worst={worst} cutoff={cutoff:.9g} ETA<={eta:.0f}s{' BEST CHECKPOINT' if improved else ''}", flush=True)
                if stale >= options["patience"]:
                    break
            model.load_state_dict(best[2])
            model.eval()
            with torch.no_grad():
                risks = torch.sigmoid(model(x))[:, head].numpy()
            members.append({"seed": seed, "epoch": best[1], "risk": risks.tolist(), "layers": [
                {"input": layer.in_features, "output": 1 if layer is model[-1] else layer.out_features,
                 "w": (layer.weight.detach().numpy()[head:head+1] if layer is model[-1] else layer.weight.detach().numpy()).ravel().tolist(),
                 "b": (layer.bias.detach().numpy()[head:head+1] if layer is model[-1] else layer.bias.detach().numpy()).tolist()}
                for layer in model if isinstance(layer, nn.Linear)
            ] if fold["symbol"] == "ALL" else []})
            print(f"MODEL hold={fold['symbol']} seed={seed} ended={epoch} selected={best[1]}", flush=True)
        results.append({"symbol": fold["symbol"], "members": members})
    return {"torch": str(torch.__version__), "numpy": str(np.__version__), "folds": results}


if __name__ == "__main__":
    with open(sys.argv[1]) as file:
        source = json.load(file)
    result = train(source)
    with open(sys.argv[2] + ".tmp", "w") as file:
        json.dump(result, file, separators=(",", ":"), allow_nan=False)
    os.replace(sys.argv[2] + ".tmp", sys.argv[2])
