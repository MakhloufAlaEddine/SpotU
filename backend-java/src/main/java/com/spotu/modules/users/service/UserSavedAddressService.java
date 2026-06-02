package com.spotu.modules.users.service;

import com.spotu.error.ApiBadRequestException;
import com.spotu.error.ApiNotFoundException;
import com.spotu.modules.auth.dto.CurrentUserDto;
import com.spotu.modules.users.infra.UserSavedAddressRepository;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
public class UserSavedAddressService {
    private final UserSavedAddressRepository repository;

    public UserSavedAddressService(UserSavedAddressRepository repository) {
        this.repository = repository;
    }

    public List<Map<String, Object>> list(CurrentUserDto user) {
        return repository.list(user.userId());
    }

    public Map<String, Object> create(CurrentUserDto user, Map<String, Object> body) {
        Payload p = parsePayload(body);
        String id = "addr_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        int pos = repository.nextPosition(user.userId());
        return repository.create(id, user.userId(), p.label(), p.address(), p.lat(), p.lng(), p.icon(), pos);
    }

    public Map<String, Object> update(CurrentUserDto user, String addressId, Map<String, Object> body) {
        Payload p = parsePayload(body);
        List<Map<String, Object>> rows = repository.update(
                addressId, user.userId(), p.label(), p.address(), p.lat(), p.lng(), p.icon()
        );
        if (rows.isEmpty()) {
            throw new ApiNotFoundException("Adresse introuvable");
        }
        return rows.get(0);
    }

    public void delete(CurrentUserDto user, String addressId) {
        int n = repository.delete(addressId, user.userId());
        if (n == 0) {
            throw new ApiNotFoundException("Adresse introuvable");
        }
    }

    private Payload parsePayload(Map<String, Object> body) {
        String label = asText(body == null ? null : body.get("label")).trim();
        String address = asText(body == null ? null : body.get("address")).trim();
        Double lat = asDouble(body == null ? null : body.get("lat"));
        Double lng = asDouble(body == null ? null : body.get("lng"));
        String icon = asText(body == null ? null : body.get("icon")).trim();
        if (icon.isEmpty()) {
            icon = "location-outline";
        }

        if (label.isEmpty() || address.isEmpty() || lat == null || lng == null) {
            throw new ApiBadRequestException("Renseignez un nom et une adresse valide.");
        }
        return new Payload(label, address, lat, lng, icon);
    }

    private static String asText(Object o) {
        return o == null ? "" : String.valueOf(o);
    }

    private static Double asDouble(Object o) {
        if (o == null) return null;
        if (o instanceof Number n) return n.doubleValue();
        return Double.parseDouble(String.valueOf(o));
    }

    private record Payload(String label, String address, double lat, double lng, String icon) {}
}
