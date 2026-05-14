# P0_08_ERROR_HANDLER_CLASSIFICATION

Classification des handlers custom hors `GlobalExceptionHandler`.

## KEEP_AS_PYTHON_COMPAT

- `ProductCreationController` formats `error` (400/404) et `detail` (403): asymetrie Python marketplace volontaire.
- `AdminProductController` format `404 -> {"error": ...}`: contrat Python admin marketplace.
- `ServicesController` format `422 -> {"detail":[...]}`: shape Python/Pydantic-like attendu front.

## ADD_CODE_NON_BREAKING

- `ProductCreationController`:
  - `ProductBadRequestError` (400)
  - `ProductValidation422Error` (422)
  - `ProductNotFoundError` (404)
  - `ProductDeleteNotFoundError` (404)
  - `ApiForbiddenException` (403)
- `AdminProductController`:
  - `AdminProductNotFoundError` (404)
- `ServicesController`:
  - `ServiceValidation422Error` (422)

Ajout realise: champ `code` en conservant `error`/`detail` existants (non-breaking).

## FIX_DIVERGENCE

- Aucun fix de status HTTP applique dans ce sous-lot (pas de divergence critique prouvee).

## TEST_ONLY

- Couverture renforcee:
  - marketplace custom errors (`ProductCreationIntegrationTest`)
  - admin marketplace (`AdminProductIntegrationTest`)
  - services 422/detail (`ServicesIntegrationTest`)
  - erreurs globales (`ErrorContractIntegrationTest` deja present)
