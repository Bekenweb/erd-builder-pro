import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function CalculationGuide({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent size="2xl" className="max-h-[82vh]">
          <DialogHeader>
            <DialogTitle>Table Calculation Guide</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-5 overflow-y-auto pr-1 text-sm leading-6">
            <section className="space-y-2">
              <h3 className="font-semibold text-foreground">How it works</h3>
              <p className="text-muted-foreground">
                Type a formula command in a table cell, then leave the cell. The editor replaces the
                command with the calculated result. Hover the result cell to see the Excel-style source
                range used for that value.
              </p>
            </section>

            <section className="space-y-2">
              <h3 className="font-semibold text-foreground">Vertical formulas</h3>
              <p className="text-muted-foreground">
                Vertical formulas calculate numeric values in the same column. They are intended for
                header or footer rows.
              </p>
              <div className="grid gap-2 rounded-md border bg-muted/30 p-3">
                <code>=SUM</code>
                <code>=SUMV</code>
                <span className="text-muted-foreground">Sum values vertically, for example: SUMV(B2:B5).</span>
                <code>=AVG</code>
                <code>=AVGV</code>
                <span className="text-muted-foreground">Average values vertically, for example: AVGV(C2:C5).</span>
                <code>=MUL</code>
                <code>=PRODUCT</code>
                <code>=MULV</code>
                <code>=PRODUCTV</code>
                <span className="text-muted-foreground">Multiply values vertically, for example: PRODUCTV(D2:D5).</span>
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="font-semibold text-foreground">Horizontal formulas</h3>
              <p className="text-muted-foreground">
                Horizontal formulas calculate numeric values to the left of the formula cell in the same row.
              </p>
              <div className="grid gap-2 rounded-md border bg-muted/30 p-3">
                <code>=SUMH</code>
                <span className="text-muted-foreground">Sum values horizontally, for example: SUMH(B2:C2).</span>
                <code>=AVGH</code>
                <span className="text-muted-foreground">Average values horizontally, for example: AVGH(B2:D2).</span>
                <code>=MULH</code>
                <code>=PRODUCTH</code>
                <span className="text-muted-foreground">Multiply values horizontally, for example: PRODUCTH(B2:C2).</span>
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="font-semibold text-foreground">Examples</h3>
              <div className="rounded-md border overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-3 py-2 font-medium">Item</th>
                      <th className="px-3 py-2 font-medium">Qty</th>
                      <th className="px-3 py-2 font-medium">Price</th>
                      <th className="px-3 py-2 font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t">
                      <td className="px-3 py-2">Hosting</td>
                      <td className="px-3 py-2">12</td>
                      <td className="px-3 py-2">90.000</td>
                      <td className="px-3 py-2"><code>=MULH</code> becomes 1.080.000</td>
                    </tr>
                    <tr className="border-t">
                      <td className="px-3 py-2">Setup</td>
                      <td className="px-3 py-2">100.000</td>
                      <td className="px-3 py-2">50.000</td>
                      <td className="px-3 py-2"><code>=SUMH</code> becomes 150.000</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="text-muted-foreground">
                Text cells are skipped. Indonesian number formatting such as 1.080.000 and decimal
                commas is accepted. Currency symbols are ignored when possible.
              </p>
            </section>
          </DialogBody>
        </DialogContent>
      </Dialog>
  );
}
