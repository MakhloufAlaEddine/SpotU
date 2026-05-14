package com.spotu.modules.users.infra;

public record BankingDetails(
        String iban,
        String bic,
        String ibanName
) {
}
