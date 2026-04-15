# SLICE_24_CURSOR_IMPLEMENTATION_NOTES.md — Notes d'implémentation Cursor
> Basé sur `user_routes.py`, `upload_routes.py`, `push_routes.py`, `r2_storage.py`.
> Généré le 2026-04-15.

---

## Objectif

Créer les controllers/services Java pour la gestion profil utilisateur, l'upload d'images (Cloudflare R2),
et les push tokens. Après S24, un utilisateur peut configurer entièrement son compte.

---

## 1. Architecture Java cible

```
src/main/java/com/spotu/
├── controller/
│   ├── UserProfileController.java       ← 🔴 S24 (PUT /profile, POST /become-coach)
│   ├── CoverController.java            ← 🔴 S24 (PATCH /{uid}/cover)
│   ├── UploadController.java           ← 🔴 S24 (POST /upload-image)
│   └── PushTokenController.java        ← 🔴 S24 (POST + DELETE /push-token)
├── service/
│   ├── UserProfileService.java         ← 🔴 S24 (logique profil)
│   ├── FileStorageService.java         ← 🔴 S24 (R2 + fallback local)
│   └── PushTokenService.java           ← 🔴 S24
├── repository/
│   ├── UserRepository.java             ← S23 (existant — à étendre)
│   └── PushTokenRepository.java        ← 🔴 S24
├── model/
│   ├── User.java                       ← S23 (existant)
│   └── PushToken.java                  ← 🔴 S24 (entity)
├── dto/
│   ├── UpdateProfileRequest.java       ← 🔴 S24
│   ├── UpdateCoverRequest.java         ← 🔴 S24
│   └── PushTokenRequest.java           ← 🔴 S24
```

---

## 2. FileStorageService — Upload R2 + fallback

```java
@Slf4j
@Service
public class FileStorageService {

    @Value("${r2.bucket:}") private String r2Bucket;
    @Value("${r2.endpoint:}") private String r2Endpoint;
    @Value("${r2.access-key-id:}") private String r2AccessKeyId;
    @Value("${r2.secret-access-key:}") private String r2SecretAccessKey;
    @Value("${r2.public-url:}") private String r2PublicUrl;

    private S3Client s3Client;

    @PostConstruct
    public void init() {
        if (isR2Configured()) {
            s3Client = S3Client.builder()
                .endpointOverride(URI.create(r2Endpoint))
                .credentialsProvider(StaticCredentialsProvider.create(
                    AwsBasicCredentials.create(r2AccessKeyId, r2SecretAccessKey)))
                .region(Region.of("auto"))
                .build();
        }
    }

    public boolean isR2Configured() {
        return r2Bucket != null && !r2Bucket.isBlank()
            && r2Endpoint != null && !r2Endpoint.isBlank();
    }

    /**
     * Upload une image compressée. Retourne l'URL publique.
     * R2 d'abord, fallback local si échec.
     */
    public UploadResult upload(byte[] data, String category, String extension) {
        String filename = UUID.randomUUID().toString().replace("-", "").substring(0, 16) + "." + extension;
        String key = category + "/" + filename;

        // Tentative R2
        if (isR2Configured()) {
            try {
                s3Client.putObject(
                    PutObjectRequest.builder()
                        .bucket(r2Bucket)
                        .key(key)
                        .contentType("image/" + extension)
                        .build(),
                    RequestBody.fromBytes(data));
                String url = r2PublicUrl.replaceAll("/$", "") + "/" + key;
                return new UploadResult(url, filename);
            } catch (Exception e) {
                log.error("R2 upload failed: {} — fallback local", e.getMessage());
            }
        }

        // Fallback local
        Path uploadsDir = Path.of("/app/backend/uploads");
        uploadsDir.toFile().mkdirs();
        try {
            Files.write(uploadsDir.resolve(filename), data);
        } catch (IOException e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Upload failed");
        }
        // URL locale construite à partir de request — ou variable d'env
        String localUrl = "/api/uploads/" + filename;
        return new UploadResult(localUrl, filename);
    }

    /**
     * Supprime un fichier uploadé (R2 ou local).
     * Fire-and-forget — ne lève jamais d'exception.
     */
    public void deleteFile(String url) {
        if (url == null || url.isBlank()) return;

        // R2
        if (r2PublicUrl != null && !r2PublicUrl.isBlank() && url.startsWith(r2PublicUrl)) {
            try {
                String key = url.substring(r2PublicUrl.length()).replaceAll("^/", "");
                s3Client.deleteObject(DeleteObjectRequest.builder()
                    .bucket(r2Bucket).key(key).build());
            } catch (Exception e) {
                log.warn("R2 delete failed: {}", e.getMessage());
            }
            return;
        }

        // Local
        if (!url.contains("/api/uploads/")) return;
        String filename = url.substring(url.lastIndexOf("/api/uploads/") + 13).split("\\?")[0];
        try {
            Path filepath = Path.of("/app/backend/uploads", filename).toRealPath();
            // Path traversal check
            if (!filepath.startsWith(Path.of("/app/backend/uploads").toRealPath())) {
                log.warn("[SEC-10] Path traversal blocked: {}", filename);
                return;
            }
            Files.deleteIfExists(filepath);
        } catch (Exception e) {
            log.warn("Local delete failed: {}", e.getMessage());
        }
    }
}
```

**Dépendance Maven** : `software.amazon.awssdk:s3:2.x` (SDK AWS S3 — compatible Cloudflare R2).

---

## 3. Magic bytes validation + compression

```java
public class ImageValidator {

    public static String detectImageType(byte[] data) {
        if (data.length < 12) return null;
        if (data[0] == (byte)0xFF && data[1] == (byte)0xD8 && data[2] == (byte)0xFF) return "jpeg";
        if (data[0] == (byte)0x89 && data[1] == 'P' && data[2] == 'N' && data[3] == 'G') return "png";
        if (data[0] == 'G' && data[1] == 'I' && data[2] == 'F') return "gif";
        if (data[0] == 'R' && data[1] == 'I' && data[2] == 'F' && data[3] == 'F'
            && data[8] == 'W' && data[9] == 'E' && data[10] == 'B' && data[11] == 'P') return "webp";
        if (data[4] == 'f' && data[5] == 't' && data[6] == 'y' && data[7] == 'p') {
            // HEIC brands
            String brand = new String(data, 8, 3);
            if ("hei,hev,mif,msf,avi".contains(brand)) return "heic";
        }
        return null;
    }
}
```

**Compression** :
```java
// Utiliser Thumbnailator ou ImageIO
BufferedImage image = ImageIO.read(new ByteArrayInputStream(data));
ByteArrayOutputStream out = new ByteArrayOutputStream();
Thumbnails.of(image).size(1920, 1920).outputQuality(0.85).outputFormat("jpg").toOutputStream(out);
```

**HEIC** : ImageIO ne supporte pas HEIC nativement. Options :
- `com.twelvemonkeys:imageio-jpeg:3.x` + plugin HEIF
- Conversion externe (libheif via ProcessBuilder)
- Accepter et stocker HEIC sans conversion (le front gère l'affichage)

---

## 4. PUT /profile — Gestion CLEARABLE_FIELDS en Java

```java
// Problème : Jackson traite absent et null de la même façon
// Solution : utiliser Map<String, Object> au lieu d'un DTO strict

@PutMapping("/users/profile")
public Map<String, Object> updateProfile(@RequestBody Map<String, Object> body, ...) {
    // body.containsKey("bio") && body.get("bio") == null → clear bio
    // !body.containsKey("bio") → ne pas toucher bio

    Set<String> CLEARABLE = Set.of("iban", "bic", "iban_name", "bio", "phone", "picture");
    Map<String, Object> updateFields = new LinkedHashMap<>();

    for (var entry : body.entrySet()) {
        if (entry.getValue() != null) {
            updateFields.put(entry.getKey(), entry.getValue());
        } else if (CLEARABLE.contains(entry.getKey())) {
            updateFields.put(entry.getKey(), null);  // clear explicite
        }
    }

    if (updateFields.isEmpty()) return currentUser;
    // ... build dynamic UPDATE SQL
}
```

---

## 5. Pièges critiques

### P1 — CLEARABLE_FIELDS : absent vs null

```
Python Pydantic model_dump(exclude_unset=True) distingue absent/null.
Java Jackson par défaut ne distingue PAS.
Solution : utiliser Map<String, Object> au lieu d'un DTO,
ou un JsonDeserializer custom qui track les champs présents.
```

### P2 — JSONB cast dynamique

```
Les champs coach_tags, goals, user_roles nécessitent ::jsonb dans le SQL.
En JPA native query : passer comme String JSON + cast.
Ou utiliser PgObject avec type="jsonb".
```

### P3 — R2 endpoint custom

```
Cloudflare R2 utilise une URL custom (pas amazonaws.com).
AWS SDK S3 : endpointOverride(URI.create(r2Endpoint))
Region : "auto" (R2 n'utilise pas de région AWS)
```

### P4 — HEIC support

```
Java ImageIO ne supporte pas HEIC nativement.
Options :
a) TwelveMonkeys ImageIO plugin (partiel)
b) Stocker HEIC tel quel sans compression
c) Convertir via libheif CLI (ProcessBuilder)
Recommandation : option (b) pour la v1, (c) en amélioration.
```

### P5 — Multipart upload config Spring

```yaml
spring:
  servlet:
    multipart:
      max-file-size: 15MB
      max-request-size: 15MB
```

---

## 6. Critères de done

| # | Critère | Tests |
|---|---|---|
| D1 | PUT /profile update dynamique partiel | TC-PRO-01, 10 |
| D2 | CLEARABLE_FIELDS : null → SET NULL | TC-PRO-02, 07, 08 |
| D3 | name vide → 400 | TC-PRO-03 |
| D4 | JSONB fields coach_tags/goals/user_roles | TC-PRO-05 |
| D5 | Ancienne photo supprimée | TC-PRO-06, 07 |
| D6 | POST /become-coach user→coach | TC-COA-01 |
| D7 | Déjà coach/admin → 400 | TC-COA-02, 03 |
| D8 | PATCH /cover ownership | TC-COV-01, 02 |
| D9 | POST /upload-image : 5 formats | TC-UPL-01, 02, 03, 10 |
| D10 | Upload 413 + 415 | TC-UPL-04, 05 |
| D11 | R2 upload + fallback local | TC-UPL-01, 08 |
| D12 | Catégorie fallback "other" | TC-UPL-06, 07 |
| D13 | Push token register + update + transfer | TC-PTK-01, 02, 03 |
| D14 | Push token format validation | TC-PTK-04 |
| D15 | Push token soft-disable | TC-PTD-01 |

---

## 7. Relation avec les Slices

| Slice | Interaction |
|---|---|
| S23 | require_auth (utilisé par tous les endpoints S24) |
| S03 | GET /profile (lecture) — S24 ajoute l'écriture |
| S29+ | SpotYou CRUD utilisera POST /upload-image |
| S32 | Services CRUD utilisera POST /upload-image |
| S34 | Chat utilisera POST /upload-image (category=chats) |
| Tous les CRUD | delete_upload_file sera réutilisé partout |
