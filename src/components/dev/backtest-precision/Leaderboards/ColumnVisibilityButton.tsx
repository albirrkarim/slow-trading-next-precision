"use client";

import RestartAltIcon from "@mui/icons-material/RestartAlt";
import ViewColumnIcon from "@mui/icons-material/ViewColumn";
import {
    Box,
    Checkbox,
    Dialog,
    DialogContent,
    DialogTitle,
    FormControlLabel,
    FormGroup,
    IconButton,
    Tooltip,
} from "@mui/material";
import { useState } from "react";

import type { HeaderGroup } from "./columns";

export function ColumnVisibilityButton(props: {
    headerGroups: HeaderGroup[];
    hiddenColumns: ReadonlySet<string>;
    onHiddenColumnsChange: (next: Set<string>) => void;
}) {
    const { headerGroups, hiddenColumns, onHiddenColumnsChange } = props;
    const [open, setOpen] = useState(false);

    const toggleLeaf = (id: string) => {
        const next = new Set(hiddenColumns);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        onHiddenColumnsChange(next);
    };

    /** Group toggle: any child still visible → hide all; none → show all. */
    const toggleGroup = (group: HeaderGroup) => {
        const children = group.children ?? [{ id: group.id }];
        const next = new Set(hiddenColumns);
        const anyVisible = children.some((child) => !next.has(child.id));
        for (const child of children) {
            if (anyVisible) next.add(child.id);
            else next.delete(child.id);
        }
        onHiddenColumnsChange(next);
    };

    const leafCheckbox = (id: string, label: string) => (
        <FormControlLabel
            control={
                <Checkbox
                    checked={!hiddenColumns.has(id)}
                    onChange={() => toggleLeaf(id)}
                    size="small"
                />
            }
            key={id}
            label={label}
            sx={{ mr: 2 }}
        />
    );

    return (
        <>
            <Tooltip title="Show / hide columns">
                <IconButton
                    aria-label="Choose visible columns"
                    onClick={() => setOpen(true)}
                    size="small"
                >
                    <ViewColumnIcon fontSize="small" />
                </IconButton>
            </Tooltip>
            <Dialog
                maxWidth="xs"
                onClose={() => setOpen(false)}
                open={open}
            >
                <DialogTitle
                    sx={{
                        alignItems: "center",
                        display: "flex",
                        justifyContent: "space-between",
                        py: 1,
                    }}
                >
                    Columns
                    <Tooltip title="Show all columns">
                        <IconButton
                            aria-label="Reset column visibility"
                            onClick={() => onHiddenColumnsChange(new Set())}
                            size="small"
                        >
                            <RestartAltIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                </DialogTitle>
                <DialogContent sx={{ py: 0 }}>
                    <FormGroup>
                        {headerGroups.map((group) => (
                            <Box key={group.id}>
                                {group.children ? (
                                    <>
                                        <FormControlLabel
                                            control={
                                                <Checkbox
                                                    checked={group.children.some(
                                                        (child) =>
                                                            !hiddenColumns.has(
                                                                child.id,
                                                            ),
                                                    )}
                                                    indeterminate={
                                                        group.children.some(
                                                            (child) =>
                                                                !hiddenColumns.has(
                                                                    child.id,
                                                                ),
                                                        ) &&
                                                        group.children.some(
                                                            (child) =>
                                                                hiddenColumns.has(
                                                                    child.id,
                                                                ),
                                                        )
                                                    }
                                                    onChange={() =>
                                                        toggleGroup(group)
                                                    }
                                                    size="small"
                                                />
                                            }
                                            label={<strong>{group.label}</strong>}
                                        />
                                        <Box
                                            sx={{
                                                display: "flex",
                                                flexWrap: "wrap",
                                                pl: 3,
                                            }}
                                        >
                                            {group.children.map((child) =>
                                                leafCheckbox(
                                                    child.id,
                                                    child.label,
                                                ),
                                            )}
                                        </Box>
                                    </>
                                ) : (
                                    leafCheckbox(group.id, group.label)
                                )}
                            </Box>
                        ))}
                    </FormGroup>
                </DialogContent>
            </Dialog>
        </>
    );
}
