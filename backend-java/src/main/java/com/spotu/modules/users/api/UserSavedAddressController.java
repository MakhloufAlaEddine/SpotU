package com.spotu.modules.users.api;

import com.spotu.modules.auth.service.AuthMeService;
import com.spotu.modules.users.service.UserSavedAddressService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/addresses")
public class UserSavedAddressController {
    private final AuthMeService authMeService;
    private final UserSavedAddressService service;

    public UserSavedAddressController(AuthMeService authMeService, UserSavedAddressService service) {
        this.authMeService = authMeService;
        this.service = service;
    }

    @GetMapping
    public List<Map<String, Object>> list(HttpServletRequest request) {
        return service.list(authMeService.requireCurrentUser(request));
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> create(@RequestBody(required = false) Map<String, Object> body, HttpServletRequest request) {
        return service.create(authMeService.requireCurrentUser(request), body);
    }

    @PutMapping("/{addressId}")
    public Map<String, Object> update(
            @PathVariable String addressId,
            @RequestBody(required = false) Map<String, Object> body,
            HttpServletRequest request
    ) {
        return service.update(authMeService.requireCurrentUser(request), addressId, body);
    }

    @DeleteMapping("/{addressId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable String addressId, HttpServletRequest request) {
        service.delete(authMeService.requireCurrentUser(request), addressId);
    }
}
