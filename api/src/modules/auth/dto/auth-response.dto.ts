import { ApiProperty } from "@nestjs/swagger";
import { Role } from "@prisma/client";

export class AuthResponseDto {

    @ApiProperty({
        description: 'Access token for authentication',
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
    example: {
    id: 'user-123',
    email: 'john.doe@example.com',
    firstName: 'John',
    lastName: 'Doe',
    role: 'USER',
    },
    })


    user:{
        id: string;
        email: string;
        firstName?: string | null;
        lastName?: string | null;
        role:Role;
    }

}