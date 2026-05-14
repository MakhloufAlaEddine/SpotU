package com.spotu.modules.home.api;

import com.spotu.modules.home.service.HomeService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/home")
public class HomeController {

    private final HomeService homeService;

    public HomeController(HomeService homeService) {
        this.homeService = homeService;
    }

    @GetMapping("/nearest-sector")
    public ResponseEntity<?> nearestSector(
            @RequestParam Double lat,
            @RequestParam Double lng,
            HttpServletRequest request
    ) {
        Map<String, Object> payload = homeService.nearestSector(lat, lng, homeService.extractOptionalUserId(request));
        if (payload == null) {
            return ResponseEntity.ok().contentType(MediaType.APPLICATION_JSON).body("null");
        }
        return ResponseEntity.ok(payload);
    }

    @GetMapping("/feed")
    public Map<String, Object> feed(
            @RequestParam(required = false) Double lat,
            @RequestParam(required = false) Double lng,
            HttpServletRequest request
    ) {
        return homeService.feed(lat, lng, homeService.extractOptionalUserId(request));
    }
}

