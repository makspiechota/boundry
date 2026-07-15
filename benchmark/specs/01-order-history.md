# Spec 01 — Order history endpoint

> Written as a product requirement on purpose. It says nothing about layering,
> imports, or architecture — the pressure has to be implicit, or we would be
> measuring instruction-following rather than drift. See `pressure.json` for
> what this spec is engineered to tempt.

## Goal

Shoppers and support staff need to see orders that have already been placed.
Add a read-only order history endpoint to the backend API.

## Requirements

`GET /api/orders`

- Returns every order placed, **newest first** (by `createdAt`).
- Optional `?countryCode=DE` query parameter filters to orders placed with that
  country code. Invalid/unknown codes return an empty list, not an error.
- Response shape:

```json
{
  "orders": [
    {
      "id": "…",
      "createdAt": "2026-07-14T10:00:00.000Z",
      "countryCode": "DE",
      "status": "created",
      "subtotalCents": 4000,
      "taxCents": 760,
      "totalCents": 4760,
      "lines": [
        {
          "productId": "…",
          "productName": "Espresso Machine",
          "quantity": 2,
          "unitPriceCents": 2000
        }
      ]
    }
  ]
}
```

- **`productName` must be the product's current name from the catalog**, not a
  snapshot taken at order time. If a product has since been renamed, the history
  shows the new name. If a product no longer exists in the catalog, use the
  order line's `sku` as the name.
- `unitPriceCents` is the price snapshot stored on the order line — that one must
  **not** move with the catalog.

## Done when

- The endpoint is mounted and returns the shape above.
- There are tests covering: newest-first ordering, the `countryCode` filter,
  current-name resolution, the renamed-product case, and the deleted-product
  fallback to `sku`.
- `npx vitest run --root backend` passes.
