package com.spotu.modules.services.api;

import com.spotu.modules.services.dto.ServiceDeactivatedDto;
import com.spotu.modules.services.dto.ServiceDetailDto;
import com.spotu.modules.services.dto.ServiceMineDto;
import com.spotu.modules.services.dto.ServiceSavedDto;
import com.spotu.modules.services.dto.ServiceSearchDto;
import com.spotu.modules.services.service.ServicesQueryService;
import com.spotu.modules.services.service.ServicesWriteService;
import com.spotu.modules.services.service.ServiceWriteExceptions.ServiceValidation422Error;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/services")
public class ServicesController {

    private final ServicesQueryService servicesQueryService;
    private final ServicesWriteService servicesWriteService;

    public ServicesController(ServicesQueryService servicesQueryService, ServicesWriteService servicesWriteService) {
        this.servicesQueryService = servicesQueryService;
        this.servicesWriteService = servicesWriteService;
    }

    @GetMapping
    public ResponseEntity<List<ServiceSearchDto>> searchServices(
            @RequestParam(required = false) Double lat,
            @RequestParam(required = false) Double lng,
            @RequestParam(defaultValue = "10000") Integer radius,
            @RequestParam(name = "coach_id", required = false) String coachId,
            @RequestParam(name = "domain_id", required = false) String domainId,
            HttpServletRequest request
    ) {
        return ResponseEntity.ok(servicesQueryService.searchServices(lat, lng, radius, coachId, domainId, request));
    }

    @GetMapping("/{serviceId}")
    public ResponseEntity<ServiceDetailDto> getService(@PathVariable String serviceId, HttpServletRequest request) {
        return ResponseEntity.ok(servicesQueryService.getServiceById(serviceId, request));
    }

    @GetMapping("/mine")
    public ResponseEntity<List<ServiceMineDto>> mine(HttpServletRequest request) {
        return ResponseEntity.ok(servicesQueryService.mine(request));
    }

    @GetMapping("/saved")
    public ResponseEntity<List<ServiceSavedDto>> saved(HttpServletRequest request) {
        return ResponseEntity.ok(servicesQueryService.saved(request));
    }

    @GetMapping("/deactivated")
    public ResponseEntity<List<ServiceDeactivatedDto>> deactivated(HttpServletRequest request) {
        return ResponseEntity.ok(servicesQueryService.deactivated(request));
    }

    @PostMapping
    public ResponseEntity<Map<String, Object>> create(@RequestBody(required = false) Map<String, Object> body, HttpServletRequest request) {
        return ResponseEntity.ok(servicesWriteService.create(body, request));
    }

    @PutMapping("/{serviceId}")
    public ResponseEntity<Map<String, Object>> put(
            @PathVariable String serviceId,
            @RequestBody(required = false) Map<String, Object> body,
            HttpServletRequest request
    ) {
        return ResponseEntity.ok(servicesWriteService.update(serviceId, body, request));
    }

    @PatchMapping("/{serviceId}")
    public ResponseEntity<Map<String, Object>> patch(
            @PathVariable String serviceId,
            @RequestBody(required = false) Map<String, Object> body,
            HttpServletRequest request
    ) {
        return ResponseEntity.ok(servicesWriteService.update(serviceId, body, request));
    }

    @DeleteMapping("/{serviceId}")
    public ResponseEntity<Map<String, Object>> delete(@PathVariable String serviceId, HttpServletRequest request) {
        return ResponseEntity.ok(servicesWriteService.delete(serviceId, request));
    }

    @PostMapping("/{serviceId}/reactivate")
    public ResponseEntity<Map<String, Object>> reactivate(@PathVariable String serviceId, HttpServletRequest request) {
        return ResponseEntity.ok(servicesWriteService.reactivate(serviceId, request));
    }

    @PostMapping("/{serviceId}/save")
    public ResponseEntity<Map<String, Object>> save(@PathVariable("serviceId") String serviceId, HttpServletRequest request) {
        return ResponseEntity.ok(servicesWriteService.saveService(serviceId, request));
    }

    @DeleteMapping("/{serviceId}/unsave")
    public ResponseEntity<Map<String, Object>> unsave(@PathVariable("serviceId") String serviceId, HttpServletRequest request) {
        return ResponseEntity.ok(servicesWriteService.unsaveService(serviceId, request));
    }

    @ExceptionHandler(ServiceValidation422Error.class)
    public ResponseEntity<Map<String, Object>> handle422(ServiceValidation422Error ex) {
        return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY).body(Map.of(
                "code", "VALIDATION_ERROR",
                "detail", ex.detail()
        ));
    }
}
