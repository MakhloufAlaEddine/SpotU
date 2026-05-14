# syntax=docker/dockerfile:1
# Multi-stage : build Maven (Java 21) → image runtime JRE 21 légère.
# Secrets : uniquement via variables d'environnement au run (docker compose / orchestrateur).

FROM maven:3.9-eclipse-temurin-21-alpine AS builder
WORKDIR /build

COPY pom.xml .
COPY src ./src

RUN mvn -B -DskipTests package

# JAR unique Spring Boot repérable sans hardcoder la version exacte du snapshot
RUN cp target/spotu-api-*-SNAPSHOT.jar /build/application.jar

FROM eclipse-temurin:21-jre-alpine AS runtime
WORKDIR /app

RUN addgroup -g 1000 spring && adduser -u 1000 -G spring -h /app -D spring

RUN mkdir -p /app/uploads && chown spring:spring /app/uploads

COPY --from=builder /build/application.jar /app/application.jar

RUN chown spring:spring /app/application.jar

USER spring

EXPOSE 8080

ENV JAVA_OPTS=""
ENV SPRING_PROFILES_ACTIVE=dev

# Port interne : aligné sur SERVER_PORT (défaut 8080 dans application.yml)
ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar /app/application.jar"]
