import { ApiProperty } from "@nestjs/swagger";
import { UserResponseDto } from "../../users/dto/user-response.dto";

export class AuthResponseDto {

    @ApiProperty({
        description: 'Access token for authentication (incluye el rol y sus permisos)',
        example:'yqwjrhgeonajUksndfAbhGuhfoaijsbafASH4asdnaShiuhfsdfeyfqff0ajs',
    })

    accessToken: string;

    @ApiProperty({
        description: 'Refresh token for obtaining new access tokens',
        example:'yqwjrhgeonajUksndfAbhGuhfoaijsbafASH4asdnaShiuhfsdfeyfqff0ajs==',
    })
    refreshToken: string;

    @ApiProperty({
    description: 'Authenticated user information',
    type: UserResponseDto,
    })
    user: UserResponseDto;

}
