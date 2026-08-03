Edit one cell in an existing Jupyter notebook.

- Use Read on the complete `.ipynb` file before NotebookEdit. A partial or stale Read is rejected.
- `cell_id` is the ID shown by Read. Cells without a stored ID are shown as `cell-N`.
- `replace` updates one cell and clears code execution results.
- `insert` adds a cell after `cell_id`, or at the beginning when `cell_id` is omitted. `cell_type` is required.
- `delete` removes the selected cell. `new_source` is ignored but remains required by the tool contract.
- Use Edit for non-notebook files.
