# GitHub-safe backup

The DHL API key has been removed from source code.

Before deploying this cleaned version, set a new Forge variable:

```powershell
forge variables set DHL_API_KEY "<YOUR_NEW_DHL_API_KEY>" -e development
```

The previous DHL API key should be rotated/revoked before publishing this repository.

Duplicate backup JavaScript files were moved into `_local-backups/`, which is ignored by Git.
